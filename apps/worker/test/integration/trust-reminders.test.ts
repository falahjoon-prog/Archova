import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { trustReminders } from '../../src/jobs/trust-reminders';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const NOW = new Date('2026-11-04T23:30:00Z'); // 10:30 on 5 Nov in Sydney

async function seed() {
  const orgId = uuidv7();
  const projectId = uuidv7();
  const user = uuidv7();
  await database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
    await s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${orgId}, ${'Org ' + orgId}, ${'org-' + orgId})`,
    );
    await s.tx.execute(
      sql`insert into platform.projects (id, org_id, name, timezone) values (${projectId}, ${orgId}, 'Tower', 'Australia/Sydney')`,
    );
    await s.tx.execute(
      sql`insert into platform.memberships (id, org_id, user_id, role, status) values (${uuidv7()}, ${orgId}, ${user}, 'member', 'active')`,
    );
  });
  let n = 0;
  const contract = (o: {
    state: string;
    retention: string;
    createdBy?: string | null;
    pc?: string;
  }) =>
    database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
      const id = uuidv7();
      n += 1;
      await s.tx.execute(
        sql`insert into financials.contracts (id, org_id, project_id, number, kind, title, status, original_value, retention_pct, sopa_state, created_by)
            values (${id}, ${orgId}, ${projectId}, ${n}, 'subcontract', ${'Trade ' + n}, 'executed', 5000000, 5, ${o.state}, ${o.createdBy === undefined ? user : o.createdBy})`,
      );
      await s.tx.execute(
        sql`insert into financials.payment_claims (id, org_id, project_id, contract_id, number, period_end, received_at, states_act, is_valid, claimed_gross, less_previous, retention, claimed_net, gst, claimed_total, schedule_due_on)
            values (${uuidv7()}, ${orgId}, ${projectId}, ${id}, 1, '2026-10-31', '2026-10-31T00:00:00Z', true, true, 100, 0, ${o.retention}, 100, 10, 110, '2026-11-10')`,
      );
      if (o.pc)
        await s.tx.execute(
          sql`insert into financials.retention_terms (id, org_id, project_id, contract_id, practical_completion_on)
              values (${uuidv7()}, ${orgId}, ${projectId}, ${id}, ${o.pc})`,
        );
      return id;
    });
  return { orgId, user, contract };
}

const run = (orgId: string) =>
  runTenantJob([trustReminders], database, { job: 'financials.trust-reminders', orgId }, NOW);

const inbox = (orgId: string, userId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ kind: string; title: string; entity_type: string }>(
      sql`select kind, title, entity_type from notifications.notifications where user_id = ${userId} order by title`,
    );
    return r.rows;
  });

describe('financials.trust-reminders', () => {
  it('tells the creator once about a missing trust account and a release that is due', async () => {
    const t = await seed();
    await t.contract({ state: 'WA', retention: '1000' }); // trust applies, none recorded
    await t.contract({ state: 'VIC', retention: '1000', pc: '2026-11-01' }); // release due
    await t.contract({ state: 'VIC', retention: '1000', pc: '2026-12-01' }); // release not yet
    await t.contract({ state: 'WA', retention: '0' }); // nothing withheld
    await t.contract({ state: 'WA', retention: '1000', createdBy: null }); // nobody to tell

    // A claim with a schedule whose payment date has passed and nothing paid.
    const late = await t.contract({ state: 'VIC', retention: '0' });
    await database.withTenantTx(jobContext(t.orgId, 'seed'), async (s) => {
      await s.tx.execute(
        sql`update financials.payment_claims set payment_due_on = '2026-11-01' where contract_id = ${late}`,
      );
      await s.tx.execute(
        sql`insert into financials.payment_schedules (id, org_id, project_id, claim_id, scheduled_amount, withheld_amount, issued_within_time)
            select ${uuidv7()}, org_id, project_id, id, 100, 0, true from financials.payment_claims where contract_id = ${late}`,
      );
    });

    expect((await run(t.orgId)).created).toBe(3);
    const rows = await inbox(t.orgId, t.user);
    expect(rows.map((r) => r.title)).toEqual([
      'C-001 Trade 1: retention trust account not recorded',
      'C-002 Trade 2: retention release is due',
      'C-006 Trade 6: claim 1 is past its payment due date',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'financials.trust_attention', entity_type: 'contract' });

    expect((await run(t.orgId)).created).toBe(0);
  });
});
