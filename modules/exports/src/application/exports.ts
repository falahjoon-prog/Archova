import { desc, eq } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { ObjectStore } from '@archova/mod-files';
import { exportJobs } from '../infra/tables';

type Row = typeof exportJobs.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toDto(r: Row) {
  return {
    id: encodeId('dataExport', r.id),
    status: r.status,
    requestedBy: r.requestedBy,
    createdAt: r.createdAt.toISOString(),
    startedAt: iso(r.startedAt),
    finishedAt: iso(r.finishedAt),
    expiresAt: iso(r.expiresAt),
    sizeBytes: r.sizeBytes,
    sha256: r.sha256,
    tableCount: r.tableCount,
    fileCount: r.fileCount,
    skippedFileCount: r.skippedFileCount,
    error: r.error,
  };
}

const DOWNLOAD_TTL_S = 900;

export function createExportsService(deps: {
  store: ObjectStore;
  newId: () => string;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());

  async function load(scope: TenantScope, id: string): Promise<Row> {
    const [row] = await scope.tx.select().from(exportJobs).where(eq(exportJobs.id, id)).limit(1);
    if (!row) throw new AppError('data_export.not_found');
    return row;
  }

  return {
    async list(scope: TenantScope) {
      const rows = await scope.tx
        .select()
        .from(exportJobs)
        .orderBy(desc(exportJobs.createdAt))
        .limit(20);
      return { data: rows.map(toDto) };
    },

    async get(scope: TenantScope, id: string) {
      return toDto(await load(scope, id));
    },

    /** Queues the export; the worker builds it when it sees the event. One at a time per org (a unique index). */
    async create(scope: TenantScope) {
      const id = deps.newId();
      try {
        const [row] = await scope.tx
          .insert(exportJobs)
          .values({ id, orgId: scope.ctx.orgId, requestedBy: scope.ctx.userId, status: 'queued' })
          .returning();
        scope.events.add({
          type: 'exports.export.requested.v1',
          entityType: 'data_export',
          entityId: id,
          entityVersion: 1,
          data: { exportId: id },
        });
        return toDto(row!);
      } catch (e) {
        if (String((e as { cause?: { code?: string } }).cause?.code ?? '') === '23505')
          throw new AppError(
            'data_export.in_progress',
            'An export is already being built. Wait for it to finish.',
          );
        throw e;
      }
    },

    /** A 15 minute link, and an event naming who asked for it: the archive holds everything the company has. */
    async download(scope: TenantScope, id: string) {
      const row = await load(scope, id);
      if (row.status === 'expired' || (row.expiresAt && row.expiresAt <= now()))
        throw new AppError('data_export.expired', 'This export has expired. Start a new one.');
      if (row.status !== 'ready' || !row.storageKey)
        throw new AppError('data_export.not_ready', 'This export is not ready to download.');
      const stamp = now().toISOString().slice(0, 10);
      const filename = `archova-export-${stamp}.zip`;
      const url = await deps.store.presignGet(row.storageKey, {
        contentDisposition: `attachment; filename="${filename}"`,
        contentType: 'application/zip',
        expiresInS: DOWNLOAD_TTL_S,
      });
      scope.events.add({
        type: 'exports.export.downloaded.v1',
        entityType: 'data_export',
        entityId: id,
        entityVersion: row.version,
        data: { exportId: id, by: scope.ctx.userId },
      });
      return {
        url,
        filename,
        expiresAt: new Date(now().getTime() + DOWNLOAD_TTL_S * 1000).toISOString(),
      };
    },
  };
}

export type ExportsService = ReturnType<typeof createExportsService>;
