import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
import { sql } from 'drizzle-orm';
import { decodeId } from '@archova/domain';
import {
  EXCLUDED_COLUMNS,
  EXCLUDED_TABLES,
  loadCatalog,
  planTables,
  runExport,
  sweepExports,
  unreviewedSensitiveColumns,
} from '@archova/mod-exports';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addMember,
  createOrg,
  createProject,
  createTestContext,
  signUp,
  uploadBytes,
  type TestContext,
} from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
});
afterAll(() => t.close());

const ctxOf = (orgId: string, userId: string) => ({
  orgId: decodeId('org', orgId)!,
  userId: decodeId('user', userId)!,
  principalType: 'member' as const,
  orgRole: 'owner' as const,
  entitlements: { plan: 'x', state: 'active' as const, modules: [], limits: {} },
  requestId: 'test',
});

const build = (exportId: string, orgId: string) =>
  runExport(
    { database: t.database, store: t.store },
    decodeId('org', orgId)!,
    decodeId('dataExport', exportId)!,
    new Date(),
  );

async function setup(label: string, projectName: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, `${label} Builders`);
  const project = await createProject(owner.browser, org.id, { name: projectName, state: 'VIC' });
  const bytes = new TextEncoder().encode(`%PDF-1.4 ${label} drawing ${Math.random()}`);
  const fileId = await uploadBytes(
    t,
    owner.browser,
    org.id,
    project.id,
    bytes,
    `${label}-A101.pdf`,
  );
  return { owner, org, project, bytes, fileId };
}

describe('one-click full data export', () => {
  it('builds a zip with every record, the original files and a manifest, and only for this org', async () => {
    const a = await setup('exp-a', 'Tower Alpha');
    const b = await setup('exp-b', 'Tower Bravo');

    const queued = await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {});
    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ status: 'queued', sha256: null });
    const again = await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('data_export.in_progress');
    const early = await a.owner.browser.post(
      `/v1/orgs/${a.org.id}/data-exports/${queued.json().id}/download`,
      {},
    );
    expect(early.json().code).toBe('data_export.not_ready');

    expect(await build(queued.json().id, a.org.id)).toBe('built');
    // A second delivery of the same event does nothing.
    expect(await build(queued.json().id, a.org.id)).toBe('skipped');

    const done = (
      await a.owner.browser.get(`/v1/orgs/${a.org.id}/data-exports/${queued.json().id}`)
    ).json();
    expect(done.status).toBe('ready');
    expect(done.fileCount).toBe(1);
    expect(done.skippedFileCount).toBe(0);

    const dl = await a.owner.browser.post(
      `/v1/orgs/${a.org.id}/data-exports/${queued.json().id}/download`,
      {},
    );
    expect(dl.statusCode).toBe(200);
    expect(dl.json().url).toContain(`exports/${decodeId('org', a.org.id)}/`);

    const key = t.store.keys().find((k) => k.startsWith(`exports/${decodeId('org', a.org.id)}/`))!;
    const zip = (await t.store.get(key))!;
    expect(createHash('sha256').update(zip).digest('hex')).toBe(done.sha256);
    expect(zip.length).toBe(done.sizeBytes);

    const entries = unzipSync(zip);
    const names = Object.keys(entries);
    expect(names).toContain('README.txt');
    expect(names).toContain('manifest.json');
    expect(names).toContain('data/people.csv');
    expect(strFromU8(entries['data/platform/projects.csv']!)).toContain('Tower Alpha');
    const fileEntry = names.find(
      (n) => n.startsWith('files/documents/') && n.includes(decodeId('file', a.fileId)!),
    );
    expect(fileEntry).toBeDefined();
    expect(Buffer.from(entries[fileEntry!]!).equals(Buffer.from(a.bytes))).toBe(true);

    // Nothing of the other org, and nothing from infrastructure or credential tables.
    for (const [name, data] of Object.entries(entries)) {
      if (!name.endsWith('.csv') && !name.endsWith('.json')) continue;
      expect(strFromU8(data)).not.toContain('Tower Bravo');
    }
    expect(names.some((n) => /^data\/(shared|sync|identity)\//.test(n))).toBe(false);
    expect(names).not.toContain('data/integrations/accounting_connections.csv');

    const manifest = JSON.parse(strFromU8(entries['manifest.json']!));
    expect(manifest.formatVersion).toBe(1);
    expect(manifest.org.name).toBe('exp-a Builders');
    const projects = manifest.tables.find(
      (x: { table: string }) => x.table === 'platform.projects',
    );
    expect(projects.rows).toBe(1);
    expect(projects.sha256).toBe(
      createHash('sha256').update(entries['data/platform/projects.csv']!).digest('hex'),
    );
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]).toMatchObject({
      status: 'included',
      sha256: createHash('sha256').update(a.bytes).digest('hex'),
    });
    expect(manifest.excludedTables.map((x: { table: string }) => x.table)).toContain(
      'integrations.accounting_connections',
    );

    // After the first finishes, a new one can start.
    const next = await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {});
    expect(next.statusCode).toBe(202);
    // The other org cannot see or fetch it.
    const peek = await b.owner.browser.get(`/v1/orgs/${b.org.id}/data-exports/${queued.json().id}`);
    expect(peek.statusCode).toBe(404);
    const theirs = await b.owner.browser.get(`/v1/orgs/${b.org.id}/data-exports`);
    expect(theirs.json().data).toHaveLength(0);
  });

  it('is for owners and admins only', async () => {
    const a = await setup('exp-perm', 'Tower Perm');
    const member = await signUp(t.app, 'exp-member');
    await addMember(a.owner.browser, a.org.id, a.project.id, member.email, 'Site Manager');
    for (const res of [
      await member.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {}),
      await member.browser.get(`/v1/orgs/${a.org.id}/data-exports`),
    ])
      expect(res.statusCode).toBe(403);
  });

  it('removes archives after their keep period and refuses a late download', async () => {
    const a = await setup('exp-old', 'Tower Old');
    const q = (await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {})).json();
    await build(q.id, a.org.id);
    const orgUuid = decodeId('org', a.org.id)!;
    await t.adminDb.withTenantTx(ctxOf(a.org.id, a.owner.userId), ({ tx }) =>
      tx.execute(
        sql`update exports.export_jobs set expires_at = now() - interval '1 hour' where org_id = ${orgUuid}`,
      ),
    );
    const swept = await sweepExports({ database: t.database, store: t.store }, orgUuid, new Date());
    expect(swept.expired).toBe(1);
    expect(t.store.keys().some((k) => k.startsWith(`exports/${orgUuid}/`))).toBe(false);
    const dl = await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports/${q.id}/download`, {});
    expect(dl.statusCode).toBe(410);
  });

  it('lists a file it cannot include instead of hiding it', async () => {
    const a = await setup('exp-skip', 'Tower Skip');
    for (const k of t.store.keys()) if (!k.startsWith('exports/')) await t.store.delete(k);
    const q = (await a.owner.browser.post(`/v1/orgs/${a.org.id}/data-exports`, {})).json();
    expect(await build(q.id, a.org.id)).toBe('built');
    const done = (await a.owner.browser.get(`/v1/orgs/${a.org.id}/data-exports/${q.id}`)).json();
    expect(done.skippedFileCount).toBeGreaterThanOrEqual(1);
  });
});

describe('what a full export contains', () => {
  it('has no unreviewed credential column and no stale exclusion', async () => {
    const owner = await signUp(t.app, 'exp-plan');
    const org = await createOrg(owner.browser, 'Plan Builders');
    const catalog = await t.database.withTenantTx(ctxOf(org.id, owner.userId), loadCatalog, {
      readOnly: true,
    });
    const plan = planTables(catalog);
    // A new column that looks like a credential must be reviewed (and dropped or listed in REVIEWED_COLUMNS).
    expect(unreviewedSensitiveColumns(plan)).toEqual([]);
    const ids = new Set(catalog.map((c) => `${c.schema}.${c.name}`));
    for (const id of Object.keys(EXCLUDED_TABLES)) expect(ids.has(id), id).toBe(true);
    for (const [id, cols] of Object.entries(EXCLUDED_COLUMNS)) {
      const table = catalog.find((c) => `${c.schema}.${c.name}` === id);
      expect(table, id).toBeDefined();
      for (const c of cols)
        expect(
          table!.columns.map((x) => x.name),
          `${id}.${c}`,
        ).toContain(c);
    }
    expect(plan.include.length).toBeGreaterThan(100);
  });
});
