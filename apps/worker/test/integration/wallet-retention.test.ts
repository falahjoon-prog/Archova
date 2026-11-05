import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { walletRetention } from '../../src/jobs/wallet-retention';
import { jobContext } from '../../src/subscribers';
import { runTenantJob } from '../../src/scheduler';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-05T08:00:00Z');
const ago = (years: number, days = 0) =>
  new Date(NOW.getTime() - years * 365 * 86_400_000 - days * 86_400_000).toISOString();

async function org() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

/** One ended grant (8 years ago) with an old and a fresh log row, plus an old and a fresh snapshot and request. */
async function seed(orgId: string) {
  const grant = uuidv7();
  const oldLog = uuidv7();
  const freshLog = uuidv7();
  const oldSnap = uuidv7();
  const freshSnap = uuidv7();
  const oldReq = uuidv7();
  const freshReq = uuidv7();
  const other = uuidv7();
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(sql`insert into workforce.compliance_grants
      (id, org_id, grantee_org_id, grantee_name, grantor_name, request_id, item_types, all_projects, expires_on,
       accepted_by, accepted_at)
      values (${grant}, ${orgId}, ${other}, 'Builder', 'Sub', ${uuidv7()}, array['other'], true, ${ago(8).slice(0, 10)}::date,
              ${uuidv7()}, ${ago(9)})`);
    for (const [id, retain] of [
      [oldLog, ago(0, 1)],
      [freshLog, ago(-1)],
    ] as const)
      await s.tx.execute(sql`insert into workforce.compliance_access_log
        (id, org_id, grant_id, grantee_org_id, grantee_name, kind, at, retain_until)
        values (${id}, ${orgId}, ${grant}, ${other}, 'Builder', 'list', ${ago(7, 2)}, ${retain})`);
    for (const [id, retain] of [
      [oldSnap, ago(0, 1)],
      [freshSnap, ago(-1)],
    ] as const)
      await s.tx.execute(sql`insert into workforce.compliance_reliance_snapshots
        (id, org_id, grant_id, subbie_org_id, subbie_name, document_id, item_type, reason, dto, sha256, retain_until)
        values (${id}, ${orgId}, ${grant}, ${other}, 'Sub', ${uuidv7()}, 'other', 'other', '{}'::jsonb,
                ${'a'.repeat(64)}, ${retain})`);
    for (const [id, made] of [
      [oldReq, ago(8)],
      [freshReq, ago(1)],
    ] as const)
      await s.tx.execute(sql`insert into workforce.compliance_access_requests
        (id, org_id, requester_name, all_projects, item_types, grant_expires_on, code_hash, code_expires_at, status,
         created_at)
        values (${id}, ${orgId}, 'Builder', true, array['other'], ${ago(7).slice(0, 10)}::date, ${id.replace(/-/g, '') + id.replace(/-/g, '').slice(0, 32)},
                ${made}, 'cancelled', ${made})`);
  });
  return { grant, oldLog, freshLog, oldSnap, freshSnap, oldReq, freshReq };
}

const exists = (orgId: string, table: string, id: string) =>
  database.withTenantTx(jobContext(orgId, 'check'), async (s) => {
    const r = await s.tx.execute(
      sql`select 1 from ${sql.raw('workforce.' + table)} where id = ${id}`,
    );
    return r.rows.length === 1;
  });

describe('workforce.wallet-retention', () => {
  it('removes only what is past its period, keeps the rest, and leaves other orgs alone', async () => {
    const a = await org();
    const b = await org();
    const sa = await seed(a);
    const sb = await seed(b);
    const job = walletRetention();
    const run = (id: string) => runTenantJob([job], database, { job: job.name, orgId: id }, NOW);

    expect(await run(a)).toEqual({ logs: 1, snapshots: 1, grants: 0, requests: 1 });
    expect(await exists(a, 'compliance_access_log', sa.oldLog)).toBe(false);
    expect(await exists(a, 'compliance_access_log', sa.freshLog)).toBe(true);
    expect(await exists(a, 'compliance_reliance_snapshots', sa.oldSnap)).toBe(false);
    expect(await exists(a, 'compliance_reliance_snapshots', sa.freshSnap)).toBe(true);
    expect(await exists(a, 'compliance_access_requests', sa.oldReq)).toBe(false);
    expect(await exists(a, 'compliance_access_requests', sa.freshReq)).toBe(true);
    // The grant stays while a log row still refers to it.
    expect(await exists(a, 'compliance_grants', sa.grant)).toBe(true);
    // Another org's rows are untouched.
    expect(await exists(b, 'compliance_access_log', sb.oldLog)).toBe(true);
    // A second run finds nothing more.
    expect(await run(a)).toEqual({ logs: 0, snapshots: 0, grants: 0, requests: 0 });
  });

  it('removes an ended grant once its log is gone, and nothing under a legal hold', async () => {
    const held = await org();
    const sh = await seed(held);
    await database.withTenantTx(jobContext(held, 'hold'), (s) =>
      s.tx.execute(sql`insert into shared.legal_holds (id, org_id, reason, placed_by)
        values (${uuidv7()}, ${held}, 'dispute', ${uuidv7()})`),
    );
    const job = walletRetention();
    const run = (id: string) => runTenantJob([job], database, { job: job.name, orgId: id }, NOW);
    expect(await run(held)).toEqual({ logs: 0, snapshots: 0, grants: 0, requests: 0 });
    expect(await exists(held, 'compliance_access_log', sh.oldLog)).toBe(true);
    expect(await exists(held, 'compliance_reliance_snapshots', sh.oldSnap)).toBe(true);
  });

  it('lets the database refuse an early delete or any update', async () => {
    const id = await org();
    const s = await seed(id);
    const attempt = (query: ReturnType<typeof sql>) =>
      database.withTenantTx(jobContext(id, 'x'), (sc) => sc.tx.execute(query));
    await expect(
      attempt(sql`delete from workforce.compliance_access_log where id = ${s.freshLog}`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/retention/) } });
    await expect(
      attempt(sql`delete from workforce.compliance_reliance_snapshots where id = ${s.freshSnap}`),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/retention/) } });
    // The date cannot be pulled forward, nor anything else changed.
    await expect(
      attempt(
        sql`update workforce.compliance_access_log set retain_until = now() where id = ${s.freshLog}`,
      ),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/never updated/) } });
    await expect(attempt(sql`truncate workforce.compliance_access_log`)).rejects.toBeTruthy();
  });
});
