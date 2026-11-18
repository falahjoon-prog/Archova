import { createHash } from 'node:crypto';
import { PassThrough, Transform, type Readable } from 'node:stream';
import archiver from 'archiver';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import type { Database, TenantContext, TenantScope } from '@archova/kernel';
import type { ObjectStore } from '@archova/mod-files';
import {
  FORMAT_VERSION,
  filePath,
  readme,
  type Manifest,
  type ManifestFile,
} from '../domain/archive';
import { csvHeader, csvRows } from '../domain/csv';
import { planTables, type CatalogTable } from '../domain/plan';
import { exportJobs } from '../infra/tables';

/** How long a finished archive stays downloadable. */
export const KEEP_DAYS = 7;
const FETCH = 2000;

export interface BuildDeps {
  database: Database;
  store: ObjectStore;
  log?: (msg: string, data?: Record<string, unknown>) => void;
}

export const exportKey = (orgId: string, jobId: string) => `exports/${orgId}/${jobId}.zip`;

const ctxFor = (orgId: string, userId: string, jobId: string): TenantContext => ({
  orgId,
  userId,
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
  requestId: `exports:${jobId}`,
});

const q = sql.identifier;

/** Tenant tables as the database sees them: row-level security on and an org_id column. */
export async function loadCatalog(scope: TenantScope): Promise<CatalogTable[]> {
  const { rows } = await scope.tx.execute<{
    schema: string;
    name: string;
    columns: Array<{ name: string; type: string }>;
  }>(sql`
    select n.nspname as schema, c.relname as name,
           (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, null)) order by a.attnum)
              from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as columns
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and c.relrowsecurity and not c.relispartition
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
       and n.nspname not in ('pg_catalog', 'information_schema')`);
  return rows;
}

/** The archive plus one place that learns it has failed, so every wait on an entry stops when the build does. */
class Zip {
  readonly archive = archiver('zip', { zlib: { level: 6 }, forceZip64: true });
  private readonly failed: Promise<never>;
  private waiting = new Map<string, () => void>();

  constructor() {
    this.failed = new Promise<never>((_resolve, reject) => {
      this.archive.on('error', reject);
    });
    this.failed.catch(() => undefined);
    this.archive.on('entry', (e: { name: string }) => {
      this.waiting.get(e.name)?.();
      this.waiting.delete(e.name);
    });
  }

  fail(err: unknown) {
    this.archive.destroy(err instanceof Error ? err : new Error(String(err)));
  }

  private added(name: string): Promise<void> {
    const entryDone = new Promise<void>((resolve) => this.waiting.set(name, resolve));
    return Promise.race([entryDone, this.failed]);
  }

  /** Writes one entry: `produce` pushes chunks (with back-pressure) and returns when the entry is complete. */
  async text(
    name: string,
    produce: (write: (chunk: string) => Promise<void>) => Promise<void>,
  ): Promise<string> {
    const pass = new PassThrough();
    const hash = createHash('sha256');
    pass.on('data', (c: Buffer) => hash.update(c));
    const done = this.added(name);
    this.archive.append(pass, { name });
    const write = (chunk: string) =>
      new Promise<void>((resolve, reject) => {
        if (pass.write(chunk)) resolve();
        else pass.once('drain', resolve).once('error', reject);
      });
    try {
      await Promise.race([produce(write), this.failed]);
    } finally {
      pass.end();
    }
    await done;
    return hash.digest('hex');
  }

  /** Streams one object into the archive and returns its SHA-256 and size. */
  async stream(name: string, source: Readable): Promise<{ sha256: string; size: number }> {
    const hash = createHash('sha256');
    let size = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk);
        size += chunk.length;
        cb(null, chunk);
      },
    });
    const done = this.added(name);
    source.once('error', (e) => this.fail(e));
    this.archive.append(source.pipe(tap), { name });
    await done;
    return { sha256: hash.digest('hex'), size };
  }
}

interface FileRow {
  id: string;
  project_id: string | null;
  module: string;
  storage_key: string;
  filename: string;
  mime: string;
  size_bytes: string | number;
  sha256: string;
  status: string;
  deleted_at: Date | null;
}

/**
 * Builds the archive for one queued export. Idempotent on the job: a job that is no longer `queued` is left alone, so a
 * re-delivered event cannot build it twice. Reads run as the organisation (row-level security on), one transaction
 * per table, so no single transaction lives long and nothing outside this org can be read.
 */
export async function runExport(
  deps: BuildDeps,
  orgId: string,
  jobId: string,
  now: Date,
): Promise<'built' | 'skipped' | 'failed'> {
  const { database, store } = deps;
  const log = deps.log ?? (() => undefined);
  const claimed = await database.withTenantTx(ctxFor(orgId, orgId, jobId), async (s) => {
    const rows = await s.tx
      .update(exportJobs)
      .set({ status: 'running', startedAt: now })
      .where(and(eq(exportJobs.id, jobId), eq(exportJobs.status, 'queued')))
      .returning({ requestedBy: exportJobs.requestedBy });
    return rows[0] ?? null;
  });
  if (!claimed) return 'skipped';
  const ctx = ctxFor(orgId, claimed.requestedBy, jobId);
  const key = exportKey(orgId, jobId);

  const zip = new Zip();
  const archive = zip.archive;
  const out = new PassThrough();
  const zipHash = createHash('sha256');
  let zipSize = 0;
  out.on('data', (c: Buffer) => {
    zipHash.update(c);
    zipSize += c.length;
  });
  archive.pipe(out);
  const upload = store.putStream(key, out, { contentType: 'application/zip' });
  // A failed upload must stop the build rather than leave it writing into a stream nobody reads.
  upload.catch((e: unknown) => zip.fail(e));
  archive.on('warning', (w) => log('export archive warning', { jobId, message: String(w) }));

  try {
    const org = await database.withTenantTx(
      ctx,
      async (s) => {
        const { rows } = await s.tx.execute<Record<string, unknown>>(
          sql`select id, name, legal_name, abn, slug, country, default_state, timezone, kind, created_at from platform.orgs where id = ${orgId}`,
        );
        return rows[0] ?? { id: orgId };
      },
      { readOnly: true },
    );
    const catalog = await database.withTenantTx(ctx, loadCatalog, { readOnly: true });
    const plan = planTables(catalog);

    await zip.text('README.txt', (w) => w(readme({ name: String(org.name ?? '') }, now)));

    const manifest: Manifest = {
      formatVersion: FORMAT_VERSION,
      generatedAt: now.toISOString(),
      org,
      requestedBy: claimed.requestedBy,
      tables: [],
      files: [],
      excludedTables: plan.excluded,
    };
    const fileRows: FileRow[] = [];

    for (const t of plan.include) {
      const columns = t.columns;
      const collect = t.id === 'files.file_objects';
      let rows = 0;
      const path = `data/${t.schema}/${t.name}.csv`;
      const sha256 = await zip.text(path, async (write) => {
        await write(csvHeader(columns.map((c) => c.name)));
        await database.withTenantTx(
          ctx,
          async (s) => {
            const cols = sql.join(
              columns.map((c) => q(c.name)),
              sql`, `,
            );
            await s.tx.execute(
              sql`declare export_cur no scroll cursor for select ${cols} from ${q(t.schema)}.${q(t.name)} where org_id = ${orgId} order by 1`,
            );
            for (;;) {
              const { rows: batch } = await s.tx.execute<Record<string, unknown>>(
                sql.raw(`fetch ${FETCH} from export_cur`),
              );
              if (batch.length === 0) break;
              rows += batch.length;
              if (collect) fileRows.push(...(batch as unknown as FileRow[]));
              await write(csvRows(batch, columns));
            }
          },
          { readOnly: true, statementTimeout: '60s' },
        );
      });
      manifest.tables.push({
        path,
        table: t.id,
        rows,
        columns: columns.map((c) => c.name),
        sha256,
      });
      log('export table written', { jobId, table: t.id, rows });
    }

    // People: who the user ids in the records belong to (members, and people added to a project).
    const peopleCols = [
      { name: 'user_id', type: 'uuid' },
      { name: 'name', type: 'text' },
      { name: 'email', type: 'text' },
      { name: 'org_role', type: 'text' },
      { name: 'status', type: 'text' },
    ];
    const people = await database.withTenantTx(
      ctx,
      async (s) =>
        (
          await s.tx.execute<Record<string, unknown>>(sql`
            select u.id as user_id, u.name, u.email::text as email, m.role as org_role, u.status
              from identity.users u
              left join platform.memberships m on m.user_id = u.id and m.org_id = ${orgId}
             where u.id in (select user_id from platform.memberships where org_id = ${orgId}
                            union select user_id from platform.project_members where org_id = ${orgId})
             order by u.email`)
        ).rows,
      { readOnly: true },
    );
    const peoplePath = 'data/people.csv';
    const peopleSha = await zip.text(peoplePath, async (write) => {
      await write(csvHeader(peopleCols.map((c) => c.name)));
      await write(csvRows(people, peopleCols));
    });
    manifest.tables.push({
      path: peoplePath,
      table: 'people',
      rows: people.length,
      columns: peopleCols.map((c) => c.name),
      sha256: peopleSha,
    });

    // Files: originals, streamed one at a time so memory stays flat however big a drawing set is.
    let skipped = 0;
    for (const f of fileRows) {
      const base: Omit<ManifestFile, 'status' | 'path'> = {
        id: f.id,
        projectId: f.project_id,
        module: f.module,
        filename: f.filename,
        mime: f.mime,
        sizeBytes: Number(f.size_bytes),
        sha256: f.sha256,
      };
      const skip = (reason: string) => {
        skipped += 1;
        manifest.files.push({ ...base, path: null, status: 'skipped', reason });
      };
      if (f.deleted_at) {
        skip('Deleted in Archova.');
        continue;
      }
      if (f.status !== 'ready') {
        skip(
          f.status === 'infected'
            ? 'Blocked by the malware scan.'
            : `Not available (status ${f.status}).`,
        );
        continue;
      }
      const source = await store.getStream(f.storage_key);
      if (!source) {
        skip('Missing from storage.');
        continue;
      }
      const path = filePath(f);
      const res = await zip.stream(path, source);
      manifest.files.push({
        ...base,
        path,
        status: 'included',
        sizeBytes: res.size,
        sha256: res.sha256,
        ...(res.sha256 !== f.sha256 ? { checksumMismatch: true } : {}),
      });
    }

    await zip.text('manifest.json', (w) => w(`${JSON.stringify(manifest, null, 2)}\n`));
    await Promise.all([archive.finalize(), upload]);

    const finished = new Date();
    await database.withTenantTx(ctx, (s) =>
      s.tx
        .update(exportJobs)
        .set({
          status: 'ready',
          storageKey: key,
          sizeBytes: zipSize,
          sha256: zipHash.digest('hex'),
          tableCount: manifest.tables.length,
          fileCount: manifest.files.length - skipped,
          skippedFileCount: skipped,
          finishedAt: finished,
          expiresAt: new Date(finished.getTime() + KEEP_DAYS * 86_400_000),
        })
        .where(eq(exportJobs.id, jobId)),
    );
    log('export ready', { jobId, bytes: zipSize, tables: manifest.tables.length, skipped });
    return 'built';
  } catch (err) {
    zip.fail(err);
    out.destroy();
    await upload.catch(() => undefined);
    await store.delete(key).catch(() => undefined);
    log('export failed', { jobId, err: err instanceof Error ? err.message : String(err) });
    await database.withTenantTx(ctx, (s) =>
      s.tx
        .update(exportJobs)
        .set({
          status: 'failed',
          finishedAt: new Date(),
          error:
            'The export could not be completed. Start it again, and contact support if it fails twice.',
        })
        .where(eq(exportJobs.id, jobId)),
    );
    return 'failed';
  }
}

/** Daily: deletes archives past their keep period and marks stuck runs failed so a new export can start. */
export async function sweepExports(
  deps: Pick<BuildDeps, 'database' | 'store'>,
  orgId: string,
  now: Date,
): Promise<{ expired: number; failed: number }> {
  const ctx = ctxFor(orgId, orgId, `exports-sweep:${orgId}`);
  const expired = await deps.database.withTenantTx(ctx, (s) =>
    s.tx
      .select({ id: exportJobs.id, key: exportJobs.storageKey })
      .from(exportJobs)
      .where(and(eq(exportJobs.status, 'ready'), lt(exportJobs.expiresAt, now))),
  );
  for (const e of expired) {
    if (e.key) await deps.store.delete(e.key);
    await deps.database.withTenantTx(ctx, (s) =>
      s.tx.update(exportJobs).set({ status: 'expired' }).where(eq(exportJobs.id, e.id)),
    );
  }
  // A build that has run for over 12 hours, or has waited that long to start, is not coming back (the worker died or
  // the request was lost); fail it so the org can try again.
  const cutoff = new Date(now.getTime() - 12 * 3_600_000);
  const stuck = await deps.database.withTenantTx(ctx, (s) =>
    s.tx
      .update(exportJobs)
      .set({
        status: 'failed',
        finishedAt: now,
        error: 'The export was interrupted. Start it again.',
      })
      .where(
        or(
          and(eq(exportJobs.status, 'running'), lt(exportJobs.startedAt, cutoff)),
          and(eq(exportJobs.status, 'queued'), lt(exportJobs.createdAt, cutoff)),
        ),
      )
      .returning({ id: exportJobs.id }),
  );
  return { expired: expired.length, failed: stuck.length };
}
