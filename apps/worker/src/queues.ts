import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Database } from '@archova/kernel';
import type { Publish, RelayedEvent } from './relay';
import type pg from 'pg';
import { fanOut, runTenantJob, type TenantJob } from './scheduler';
import { loadEvent, subscribersFor, subscriberJobId, type Subscriber } from './subscribers';

export const EVENTS_QUEUE = 'events';
export const SUBSCRIBERS_QUEUE = 'subscribers';
export const SCHEDULED_QUEUE = 'scheduled';
export const MAINTENANCE_QUEUE = 'maintenance';

const KEEP = { removeOnComplete: { age: 3600, count: 10_000 }, removeOnFail: { age: 14 * 86_400 } };

export const connectionFor = (redisUrl: string): ConnectionOptions => {
  const u = new URL(redisUrl);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
  };
};

/** Relay output: one `events` job per outbox row, `jobId = eventId`, so a replay after a crash is a no-op. */
export function eventsPublisher(queue: Queue): Publish {
  return async (events) => {
    await queue.addBulk(
      events.map((e) => ({
        name: e.type,
        data: e,
        opts: { jobId: e.id, attempts: 5, backoff: { type: 'exponential', delay: 1000 }, ...KEEP },
      })),
    );
  };
}

/** Dispatcher: fans an event out to each matching subscriber as its own job (`jobId = eventId.subscriber`). */
export async function dispatch(
  event: RelayedEvent,
  registry: readonly Subscriber[],
  subscribers: Pick<Queue, 'addBulk'>,
): Promise<number> {
  const targets = subscribersFor(registry, event.type);
  if (targets.length === 0) return 0;
  await subscribers.addBulk(
    targets.map((s) => ({
      name: s.name,
      data: event,
      opts: {
        jobId: subscriberJobId(event.id, s.name),
        attempts: 5,
        backoff: { type: 'exponential' as const, delay: 2000 },
        ...KEEP,
      },
    })),
  );
  return targets.length;
}

/** Per-org jobs keep their ids (so a re-delivered fan-out is a no-op) and retry with backoff. */
export function maintenanceBulk(queue: Pick<Queue, 'addBulk'>) {
  return {
    addBulk: (jobs: Parameters<Queue['addBulk']>[0]) =>
      queue.addBulk(
        jobs.map((j) => ({
          ...j,
          opts: {
            ...j.opts,
            attempts: 3,
            backoff: { type: 'exponential' as const, delay: 5000 },
            ...KEEP,
          },
        })),
      ),
  };
}

export interface Running {
  close(): Promise<void>;
}

export function startQueues(
  redisUrl: string,
  database: Database,
  registry: readonly Subscriber[],
  scheduled: {
    platform: pg.Pool;
    jobs: readonly TenantJob[];
    log: (msg: string, o: object) => void;
  },
): { publish: Publish; running: Running } {
  const connection = connectionFor(redisUrl);
  const events = new Queue(EVENTS_QUEUE, { connection });
  const subscribers = new Queue(SUBSCRIBERS_QUEUE, { connection });
  const dispatcher = new Worker<RelayedEvent>(
    EVENTS_QUEUE,
    (job) => dispatch(job.data, registry, subscribers),
    { connection, concurrency: 20 },
  );
  const byName = new Map(registry.map((s) => [s.name, s]));
  const runner = new Worker<RelayedEvent>(
    SUBSCRIBERS_QUEUE,
    async (job) => {
      const s = byName.get(job.name);
      if (!s) throw new Error(`No subscriber ${job.name}`);
      const event = await loadEvent(database, job.data.orgId, job.data.id);
      if (!event) throw new Error(`Event ${job.data.id} not found`);
      await s.handle(event, { database });
    },
    { connection, concurrency: 10 },
  );

  // Scheduled jobs: one repeatable fan-out per job (a fixed scheduler id keeps it to one instance cluster-wide),
  // then one maintenance job per org that runs as that org.
  const scheduler = new Queue(SCHEDULED_QUEUE, { connection });
  const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
  for (const job of scheduled.jobs) {
    scheduler
      .upsertJobScheduler(
        job.name,
        { pattern: job.cron, tz: 'UTC' },
        {
          name: job.name,
          opts: { removeOnComplete: { count: 100 }, removeOnFail: { age: 14 * 86_400 } },
        },
      )
      .catch((err) =>
        scheduled.log('could not register scheduled job', { job: job.name, err: String(err) }),
      );
  }
  const fanOutWorker = new Worker(
    SCHEDULED_QUEUE,
    async (job) => {
      const def = scheduled.jobs.find((j) => j.name === job.name);
      if (!def) throw new Error(`No scheduled job ${job.name}`);
      const orgs = await fanOut(scheduled.platform, maintenanceBulk(maintenance), def, new Date());
      scheduled.log('scheduled fan-out', { job: def.name, orgs });
    },
    { connection, concurrency: 1 },
  );
  const maintenanceWorker = new Worker<{ job: string; orgId: string }>(
    MAINTENANCE_QUEUE,
    async (job) => {
      const summary = await runTenantJob(scheduled.jobs, database, job.data);
      scheduled.log('maintenance job', { job: job.data.job, orgId: job.data.orgId, ...summary });
    },
    { connection, concurrency: 5 },
  );
  return {
    publish: eventsPublisher(events),
    running: {
      async close() {
        await Promise.all([
          dispatcher.close(),
          runner.close(),
          fanOutWorker.close(),
          maintenanceWorker.close(),
        ]);
        await Promise.all([
          events.close(),
          subscribers.close(),
          scheduler.close(),
          maintenance.close(),
        ]);
      },
    },
  };
}
