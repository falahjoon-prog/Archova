import type pg from 'pg';
import type { Database } from '@archova/kernel';
import { jobContext } from './subscribers';

/**
 * Scheduled jobs (backend 05 §3). A repeatable job on `scheduled` lists the live orgs as `app_platform` (ids and time
 * zones only) and queues one `maintenance` job per org and period; each of those runs as that org through
 * `withTenantTx`, exactly like an API request. Nothing here reads tenant data across orgs.
 */
export interface TenantJob {
  /** Unique; part of the job id. */
  name: string;
  /** Standard 5-field cron, in UTC. */
  cron: string;
  /** Idempotent: the same org may be handed this twice. Returns a small summary for the log. */
  run(database: Database, orgId: string, now: Date): Promise<Record<string, number>>;
}

export interface OrgRef {
  id: string;
  timezone: string;
}

const PAGE = 1000;

/** Live orgs in id order, a page at a time, so a large install never loads them all at once. */
export async function* liveOrgs(pool: pg.Pool): AsyncGenerator<OrgRef[]> {
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const { rows } = await pool.query<{ id: string; timezone: string }>(
      'select id, timezone from platform.orgs where deleted_at is null and id > $1 order by id limit $2',
      [after, PAGE],
    );
    if (rows.length === 0) return;
    yield rows;
    if (rows.length < PAGE) return;
    after = rows[rows.length - 1]!.id;
  }
}

/** One period per UTC day (or hour for sub-daily crons), so a re-delivered fan-out cannot double-queue an org. */
export const periodOf = (now: Date, cron: string) =>
  cron.split(' ')[1] === '*' ? now.toISOString().slice(0, 13) : now.toISOString().slice(0, 10);

export interface FanOutQueue {
  addBulk(
    jobs: Array<{ name: string; data: { job: string; orgId: string }; opts: { jobId: string } }>,
  ): Promise<unknown>;
}

export async function fanOut(
  pool: pg.Pool,
  queue: FanOutQueue,
  job: Pick<TenantJob, 'name' | 'cron'>,
  now: Date,
): Promise<number> {
  let n = 0;
  for await (const orgs of liveOrgs(pool)) {
    const period = periodOf(now, job.cron);
    await queue.addBulk(
      orgs.map((o) => ({
        name: job.name,
        data: { job: job.name, orgId: o.id },
        opts: { jobId: `${job.name}.${o.id}.${period}` },
      })),
    );
    n += orgs.length;
  }
  return n;
}

export async function runTenantJob(
  jobs: readonly TenantJob[],
  database: Database,
  data: { job: string; orgId: string },
  now: Date = new Date(),
) {
  const job = jobs.find((j) => j.name === data.job);
  if (!job) throw new Error(`No scheduled job ${data.job}`);
  return job.run(database, data.orgId, now);
}

/** Tenant context for a job run; kept here so job files do not reach into the subscriber module. */
export { jobContext };
