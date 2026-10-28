import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@archova/kernel';
import { uuidv7 } from '@archova/domain';
import { testAppUrl } from '@archova/testing';
import { importStagingPurge } from '../../src/jobs/import-staging';
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

describe('integrations.staging-purge', () => {
  it('deletes rows of old finished jobs, cancels abandoned ones, and keeps recent work and other orgs', async () => {
    const orgId = await insertOrg();
    const other = await insertOrg();
    const seed = async (org: string) => {
      const job = async (
        status: string,
        updatedDaysAgo: number,
        finishedDaysAgo: number | null,
      ) => {
        const id = uuidv7();
        await database.withTenantTx(jobContext(org, 'seed'), async (s) => {
          await s.tx.execute(sql`insert into integrations.import_jobs
            (id, org_id, project_id, entity, file_id, status, started_by, updated_at, finished_at)
            values (${id}, ${org}, ${uuidv7()}, 'rfi', ${uuidv7()}, ${status}, ${uuidv7()},
                    ${days(updatedDaysAgo)}, ${finishedDaysAgo === null ? null : days(finishedDaysAgo)})`);
          await s.tx
            .execute(sql`insert into integrations.import_rows (id, org_id, job_id, row_number, raw)
            values (${uuidv7()}, ${org}, ${id}, 1, '{}'), (${uuidv7()}, ${org}, ${id}, 2, '{}')`);
        });
        return id;
      };
      return {
        oldDone: await job('done', 40, 35),
        recentDone: await job('done', 5, 3),
        oldAbandoned: await job('mapped', 45, null),
        recentOpen: await job('parsed', 2, null),
      };
    };
    const jobs = await seed(orgId);
    await seed(other);

    const read = (org: string) =>
      database.withTenantTx(jobContext(org, 'read'), async (s) => {
        const rows = await s.tx.execute<{ job_id: string; n: number }>(
          sql`select job_id, count(*)::int as n from integrations.import_rows group by job_id`,
        );
        const status = await s.tx.execute<{ id: string; status: string }>(
          sql`select id, status from integrations.import_jobs`,
        );
        return {
          rows: Object.fromEntries(rows.rows.map((r) => [r.job_id, r.n])),
          status: Object.fromEntries(status.rows.map((r) => [r.id, r.status])),
        };
      });

    const first = await runTenantJob([importStagingPurge], database, {
      job: importStagingPurge.name,
      orgId,
    });
    // The abandoned job is closed in this pass; its rows go with the next one (30 days after it finished).
    expect(first).toEqual({ abandonedJobsCancelled: 1, rowsDeleted: 2 });
    const after = await read(orgId);
    expect(after.rows[jobs.oldDone]).toBeUndefined();
    expect(after.rows[jobs.recentDone]).toBe(2);
    expect(after.rows[jobs.oldAbandoned]).toBe(2);
    expect(after.rows[jobs.recentOpen]).toBe(2);
    expect(after.status[jobs.oldAbandoned]).toBe('cancelled');
    expect(after.status[jobs.recentOpen]).toBe('parsed');
    expect(after.status[jobs.oldDone]).toBe('done');

    expect(Object.keys((await read(other)).rows)).toHaveLength(4);
    expect(
      await runTenantJob([importStagingPurge], database, { job: importStagingPurge.name, orgId }),
    ).toEqual({ abandonedJobsCancelled: 0, rowsDeleted: 0 });
  });
});
