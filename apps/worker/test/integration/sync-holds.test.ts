import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { syncHoldsPurge } from '../../src/jobs/sync-holds';
import { runTenantJob } from '../../src/scheduler';
import { jobContext } from '../../src/subscribers';

let database: Database;
beforeAll(() => {
  database = createDatabase(testAppUrl());
});
afterAll(() => database.close());

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

async function insertOrg() {
  const id = uuidv7();
  await database.withTenantTx(jobContext(id, 't'), (s) =>
    s.tx.execute(
      sql`insert into platform.orgs (id, name, slug) values (${id}, ${'Org ' + id}, ${'org-' + id})`,
    ),
  );
  return id;
}

describe('sync.holds-purge', () => {
  it('deletes old push records, undecided held changes and dead grants, and keeps decided rows, live grants and other orgs', async () => {
    const orgId = await insertOrg();
    const other = await insertOrg();
    const seed = async (org: string) => {
      const user = uuidv7();
      const ids = { oldGrant: uuidv7(), usedGrant: uuidv7(), liveGrant: uuidv7() };
      await database.withTenantTx(jobContext(org, 'seed'), async (s) => {
        const grant = (id: string, expiresDaysAgo: number) =>
          s.tx
            .execute(sql`insert into sync.drain_grants (id, org_id, user_id, token_hash, expires_at)
            values (${id}, ${org}, ${user}, ${id}, ${days(expiresDaysAgo)})`);
        await grant(ids.oldGrant, 40);
        await grant(ids.usedGrant, 40);
        await grant(ids.liveGrant, -2);
        const held = (status: string, receivedDaysAgo: number) =>
          s.tx.execute(sql`insert into sync.late_submissions
            (org_id, user_id, mutation_id, grant_id, project_id, module, command, entity_id, client_at, received_at, status)
            values (${org}, ${user}, ${uuidv7()}, ${ids.usedGrant}, ${uuidv7()}, 'defects', 'defects.transition', 'x',
                    now(), ${days(receivedDaysAgo)}, ${status})`);
        await held('pending', 40);
        await held('pending', 5);
        await held('accepted', 40);
        const mutation = (daysAgo: number) =>
          s.tx
            .execute(sql`insert into sync.mutations (org_id, user_id, mutation_id, command, entity_id, status, created_at)
            values (${org}, ${user}, ${uuidv7()}, 'defects.transition', 'x', 'applied', ${days(daysAgo)})`);
        await mutation(40);
        await mutation(3);
      });
      return ids;
    };
    await seed(orgId);
    await seed(other);

    const counts = (org: string) =>
      database.withTenantTx(jobContext(org, 'read'), async (s) => {
        const n = async (q: ReturnType<typeof sql>) =>
          (await s.tx.execute<{ n: number }>(q)).rows[0]!.n;
        return {
          mutations: await n(sql`select count(*)::int as n from sync.mutations`),
          held: await n(sql`select count(*)::int as n from sync.late_submissions`),
          grants: await n(sql`select count(*)::int as n from sync.drain_grants`),
        };
      });

    const result = await runTenantJob([syncHoldsPurge], database, {
      job: syncHoldsPurge.name,
      orgId,
    });
    expect(result).toEqual({ mutationsDeleted: 1, heldChangesDeleted: 1, grantsDeleted: 1 });
    // Kept: the recent mutation; the recent pending and the decided held change; the grant a held change still
    // points at, and the live one.
    expect(await counts(orgId)).toEqual({ mutations: 1, held: 2, grants: 2 });
    expect(await counts(other)).toEqual({ mutations: 2, held: 3, grants: 3 });
  });
});
