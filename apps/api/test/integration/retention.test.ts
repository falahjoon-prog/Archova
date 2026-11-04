import { sql } from 'drizzle-orm';
import { decodeId, uuidv7 } from '@archova/domain';
import {
  AppError,
  assertDeletable,
  placeLegalHold,
  recordRetention,
  releaseLegalHold,
  retentionBlock,
  type TenantContext,
} from '@archova/kernel';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrg, createTestContext, signUp, type TestContext } from './helpers';

let t: TestContext;
beforeAll(async () => {
  t = await createTestContext();
  // A stand-in for any module table that holds records someone may have to keep.
  const q = (text: string) => t.adminDb.pool.query(text);
  await q(
    'create table shared.retention_probe (id uuid primary key, org_id uuid not null, project_id uuid)',
  );
  await q("select kernel.enable_retention_guard('shared.retention_probe')");
  await q("select kernel.enable_tenant_rls('shared.retention_probe')");
  await q('grant select, insert, update, delete on shared.retention_probe to app_rw');
});
afterAll(async () => {
  await t.adminDb.pool.query('drop table shared.retention_probe');
  await t.close();
});

const ctxFor = (orgId: string): TenantContext => ({
  orgId,
  userId: '00000000-0000-0000-0000-000000000000',
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
  requestId: 'test',
});
const run = <T>(orgId: string, fn: Parameters<typeof t.database.withTenantTx<T>>[1]) =>
  t.database.withTenantTx(ctxFor(orgId), fn);
const years = (n: number) => new Date(Date.now() + n * 365 * 86_400_000);
const type = 'shared.retention_probe';
// Drizzle wraps the Postgres error; the trigger's message is on the cause.
const refused = async (p: Promise<unknown>, re: RegExp) => {
  const e = await p.then(
    () => null,
    (err: { cause?: { message?: string }; message: string }) => err,
  );
  expect(e, 'expected the database to refuse').not.toBeNull();
  expect(e!.cause?.message ?? e!.message).toMatch(re);
};

async function setup(label: string) {
  const owner = await signUp(t.app, label);
  const org = await createOrg(owner.browser, 'Ledger Pty Ltd');
  const orgId = decodeId('org', org.id)!;
  const projectId = uuidv7();
  const recordId = uuidv7();
  await run(orgId, (s) =>
    s.tx.execute(
      sql`insert into shared.retention_probe values (${recordId}, ${orgId}, ${projectId})`,
    ),
  );
  return { orgId, projectId, recordId };
}
const del = (orgId: string, id: string) =>
  run(orgId, (s) => s.tx.execute(sql`delete from shared.retention_probe where id = ${id}`));

describe('retention ledger and legal hold (compliance/07, APP 11.2)', () => {
  it('lets an untagged record be deleted', async () => {
    const s = await setup('ret-free');
    await run(s.orgId, (sc) => assertDeletable(sc, { recordType: type, recordId: s.recordId }));
    await del(s.orgId, s.recordId);
  });

  it('blocks deletion until the retention period has passed, in the guard and at the database', async () => {
    const s = await setup('ret-period');
    await run(s.orgId, (sc) =>
      recordRetention(sc, {
        recordType: type,
        recordId: s.recordId,
        projectId: s.projectId,
        category: 'financial_7y',
        anchor: new Date(),
      }),
    );
    const err = await run(s.orgId, (sc) =>
      assertDeletable(sc, { recordType: type, recordId: s.recordId }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('retention.blocked');
    expect(err.extra).toEqual({ reason: 'retention_period' });
    // Code that forgets the guard still cannot delete.
    await refused(del(s.orgId, s.recordId), /retention/);
  });

  it('frees a record whose period has ended, and only extends periods, never shortens them', async () => {
    const s = await setup('ret-expired');
    await run(s.orgId, (sc) =>
      recordRetention(sc, {
        recordType: type,
        recordId: s.recordId,
        category: 'location_at_sign_in_12m',
        anchor: years(-2),
      }),
    );
    expect(
      await run(s.orgId, (sc) => retentionBlock(sc, { recordType: type, recordId: s.recordId })),
    ).toBeNull();

    // A 10-year evidence record, then a shorter re-tag, then a customer extension.
    await run(s.orgId, (sc) =>
      recordRetention(sc, {
        recordType: type,
        recordId: s.recordId,
        category: 'sopa_evidence_10y',
        anchor: new Date(),
        extendToAtLeast: years(12),
      }),
    );
    await run(s.orgId, (sc) =>
      recordRetention(sc, {
        recordType: type,
        recordId: s.recordId,
        category: 'sopa_evidence_10y',
        anchor: years(-5),
      }),
    );
    const rows = await run(s.orgId, (sc) =>
      sc.tx.execute(
        sql`select retain_until from shared.retention_ledger where record_id = ${s.recordId} and category = 'sopa_evidence_10y'`,
      ),
    );
    expect(new Date(rows.rows[0]!.retain_until as string).getTime()).toBeGreaterThan(
      years(11).getTime(),
    );
    // And SQL cannot shorten or delete an entry in force.
    await refused(
      run(s.orgId, (sc) =>
        sc.tx.execute(
          sql`update shared.retention_ledger set retain_until = now() where record_id = ${s.recordId}`,
        ),
      ),
      /retention/,
    );
    await refused(
      run(s.orgId, (sc) =>
        sc.tx.execute(
          sql`delete from shared.retention_ledger where record_id = ${s.recordId} and category = 'sopa_evidence_10y'`,
        ),
      ),
      /retention/,
    );
  });

  it('a project hold blocks that project only, an org hold blocks everything, and releasing frees them', async () => {
    const s = await setup('ret-hold');
    const otherProject = uuidv7();
    const otherId = uuidv7();
    await run(s.orgId, (sc) =>
      sc.tx.execute(
        sql`insert into shared.retention_probe values (${otherId}, ${s.orgId}, ${otherProject})`,
      ),
    );

    const hold = await run(s.orgId, (sc) =>
      placeLegalHold(sc, { projectId: s.projectId, reason: 'Adjudication 2026-114' }),
    );
    const held = await run(s.orgId, (sc) =>
      retentionBlock(sc, { recordType: type, recordId: s.recordId, projectId: s.projectId }),
    );
    expect(held).toBe('legal_hold');
    await refused(del(s.orgId, s.recordId), /legal_hold/);
    await del(s.orgId, otherId); // another project is unaffected

    expect(await run(s.orgId, (sc) => releaseLegalHold(sc, hold))).toBe(true);
    expect(await run(s.orgId, (sc) => releaseLegalHold(sc, hold))).toBe(false);
    await refused(
      run(s.orgId, (sc) => sc.tx.execute(sql`delete from shared.legal_holds where id = ${hold}`)),
      /never deleted/,
    );
    await refused(
      run(s.orgId, (sc) =>
        sc.tx.execute(sql`update shared.legal_holds set reason = 'edited' where id = ${hold}`),
      ),
      /only be released/,
    );

    const orgHold = await run(s.orgId, (sc) => placeLegalHold(sc, { reason: 'Regulator request' }));
    await refused(del(s.orgId, s.recordId), /legal_hold/);
    await run(s.orgId, (sc) => releaseLegalHold(sc, orgHold));
    await del(s.orgId, s.recordId);
  });

  it('caps extensions, keeps releases honest, and the guard trigger is installed', async () => {
    const s = await setup('ret-caps');
    await expect(
      run(s.orgId, (sc) =>
        recordRetention(sc, {
          recordType: type,
          recordId: s.recordId,
          category: 'financial_7y',
          anchor: new Date(),
          extendToAtLeast: years(60),
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(
      run(s.orgId, (sc) =>
        recordRetention(sc, {
          recordType: type,
          recordId: s.recordId,
          category: 'financial_7y',
          anchor: years(40),
        }),
      ),
    ).rejects.toMatchObject({ code: 'validation_failed' });
    const hold = await run(s.orgId, (sc) => placeLegalHold(sc, { reason: 'Check' }));
    await refused(
      run(s.orgId, (sc) =>
        sc.tx.execute(
          sql`update shared.legal_holds set released_at = now() - interval '1 day', released_by = placed_by where id = ${hold}`,
        ),
      ),
      /current time/,
    );
    await run(s.orgId, (sc) => releaseLegalHold(sc, hold));
    await refused(
      run(s.orgId, (sc) =>
        sc.tx.execute(sql`update shared.legal_holds set released_at = now() where id = ${hold}`),
      ),
      /only be released/,
    );
    const trg = await t.adminDb.pool.query(
      "select 1 from pg_trigger where tgrelid = 'shared.retention_probe'::regclass and tgname = 'enforce_retention'",
    );
    expect(trg.rowCount).toBe(1);
  });

  it("never lets one org's hold or ledger affect another org", async () => {
    const a = await setup('ret-iso-a');
    const b = await setup('ret-iso-b');
    await run(a.orgId, (sc) => placeLegalHold(sc, { reason: 'Org A only' }));
    await del(b.orgId, b.recordId);
  });
});
