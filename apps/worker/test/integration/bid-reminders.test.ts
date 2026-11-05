import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { bidReminders } from '../../src/jobs/bid-reminders';
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
  const pkg = (o: { status?: string; dueAt: string | null; createdBy?: string | null }) =>
    database.withTenantTx(jobContext(orgId, 'seed'), async (s) => {
      const id = uuidv7();
      n += 1;
      await s.tx.execute(
        sql`insert into estimating.tender_packages (id, org_id, project_id, number, name, trade, status, due_at, created_by)
            values (${id}, ${orgId}, ${projectId}, ${n}, ${'Package ' + n}, 'Tiling', ${o.status ?? 'out_to_tender'}, ${o.dueAt}, ${o.createdBy === undefined ? user : o.createdBy})`,
      );
      return id;
    });
  return { orgId, projectId, user, pkg };
}

const run = (orgId: string) =>
  runTenantJob([bidReminders], database, { job: 'estimating.bid-reminders', orgId }, NOW);

const inbox = (orgId: string, userId: string) =>
  database.withTenantTx(jobContext(orgId, 'read'), async (s) => {
    const r = await s.tx.execute<{ kind: string; title: string; entity_type: string }>(
      sql`select kind, title, entity_type from notifications.notifications where user_id = ${userId} order by title`,
    );
    return r.rows;
  });

describe('estimating.bid-reminders', () => {
  it('tells the creator once, for packages out to tender that close soon or are overdue', async () => {
    const t = await seed();
    await t.pkg({ dueAt: '2026-11-05T05:00:00Z' }); // closes today
    await t.pkg({ dueAt: '2026-11-06T01:00:00Z' }); // closes tomorrow
    await t.pkg({ dueAt: '2026-11-01T05:00:00Z' }); // past due
    await t.pkg({ dueAt: '2026-11-20T05:00:00Z' }); // not yet
    await t.pkg({ dueAt: '2026-11-05T05:00:00Z', status: 'closed' });
    await t.pkg({ dueAt: '2026-11-05T05:00:00Z', status: 'draft' });
    await t.pkg({ dueAt: null });
    await t.pkg({ dueAt: '2026-11-05T05:00:00Z', createdBy: null });

    expect(await run(t.orgId)).toEqual({ candidates: 3, created: 3 });
    const rows = await inbox(t.orgId, t.user);
    expect(rows.map((r) => r.title)).toEqual([
      'TP-001 Package 1 closes today',
      'TP-002 Package 2 closes tomorrow',
      'TP-003 Package 3 is past its due time',
    ]);
    expect(rows[0]).toMatchObject({ kind: 'tender.bid_due_soon', entity_type: 'tender_package' });

    // The next half hour tells nobody twice.
    expect(await run(t.orgId)).toEqual({ candidates: 3, created: 0 });
  });

  it('does not tell someone who has left the team', async () => {
    const t = await seed();
    await t.pkg({ dueAt: '2026-11-05T05:00:00Z', createdBy: uuidv7() });
    expect(await run(t.orgId)).toEqual({ candidates: 1, created: 0 });
  });
});
