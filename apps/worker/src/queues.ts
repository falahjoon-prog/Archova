import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Database } from '@archova/kernel';
import type { Publish, RelayedEvent } from './relay';
import type pg from 'pg';
import { fanOut, runTenantJob, type ScheduledRoute, type TenantJob } from './scheduler';
import {
  loadEvent,
  subscribersFor,
  subscriberJobId,
  type Subscriber,
  type SubscriberQueue,
  type SubscriberRoute,
} from './subscribers';

export const EVENTS_QUEUE = 'events';
export const SUBSCRIBERS_QUEUE = 'subscribers';
/** Subscribers that run in the ai-worker (`src/ai.ts`): the dispatcher fills it, only that role empties it. */
export const AI_SUBSCRIBERS_QUEUE = 'subscribers-ai';
export const SCHEDULED_QUEUE = 'scheduled';
export const MAINTENANCE_QUEUE = 'maintenance';
/** Per-org jobs that run in the ai-worker: the default worker fills it, only that role empties it. */
export const AI_MAINTENANCE_QUEUE = 'maintenance-ai';

/**
 * Retry policy for work routed to the ai-worker. A missed drop or re-stamp leaves stale access or stale text
 * searchable, so these retry for about an hour (20 attempts, 2 s doubling to a 5 minute cap) before a job gives up;
 * the nightly sweep is the backstop after that. BullMQ has no cap on its built-in exponential backoff, so the
 * ai-worker's workers carry `cappedBackoff` under the type name `capped`.
 */
export const ROUTED_RETRY = {
  attempts: 20,
  backoff: { type: 'capped', delay: 2000 },
} as const;
export const BACKOFF_CAP_MS = 5 * 60_000;
/** The delay before retry number `attemptsMade`: 2 s, doubling, never more than the cap. */
export const cappedBackoff = (attemptsMade: number): number =>
  Math.min(BACKOFF_CAP_MS, ROUTED_RETRY.backoff.delay * 2 ** Math.max(0, attemptsMade - 1));

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
  registry: readonly SubscriberRoute[],
  subscribers: Pick<Queue, 'addBulk'>,
  /** The queues of other roles, by `SubscriberRoute.queue`. */
  routed: Partial<Record<SubscriberQueue, Pick<Queue, 'addBulk'>>> = {},
): Promise<number> {
  const targets = subscribersFor(registry, event.type);
  const byQueue = new Map<Pick<Queue, 'addBulk'>, SubscriberRoute[]>();
  for (const s of targets) {
    const queue = s.queue ? routed[s.queue] : subscribers;
    if (!queue) throw new Error(`No queue for subscriber ${s.name} (${s.queue})`);
    byQueue.set(queue, [...(byQueue.get(queue) ?? []), s]);
  }
  for (const [queue, routes] of byQueue) {
    await queue.addBulk(
      routes.map((s) => ({
        name: s.name,
        data: event,
        opts: {
          jobId: subscriberJobId(event.id, s.name),
          // Routed subscribers (the ai-worker's) retry for much longer: see `ROUTED_RETRY`.
          ...(s.queue
            ? { ...ROUTED_RETRY }
            : { attempts: 5, backoff: { type: 'exponential' as const, delay: 2000 } }),
          ...KEEP,
        },
      })),
    );
  }
  return targets.length;
}

/**
 * Runs the subscribers of one queue: each job reads its event as the tenant, then hands it to the subscriber named
 * on the job. Shared by the default worker and the ai-worker, which consume different queues.
 */
export function subscriberRunner(
  connection: ConnectionOptions,
  queue: string,
  database: Database,
  registry: readonly Subscriber[],
  concurrency: number,
  /** Only the ai-worker sets this, for the `capped` backoff its jobs are queued with. */
  settings?: { backoffStrategy: (attemptsMade: number) => number },
) {
  const byName = new Map(registry.map((s) => [s.name, s]));
  return new Worker<RelayedEvent>(
    queue,
    async (job) => {
      const s = byName.get(job.name);
      if (!s) throw new Error(`No subscriber ${job.name}`);
      const event = await loadEvent(database, job.data.orgId, job.data.id);
      if (!event) throw new Error(`Event ${job.data.id} not found`);
      await s.handle(event, { database });
    },
    { connection, concurrency, ...(settings ? { settings } : {}) },
  );
}

/** Per-org jobs keep their ids (so a re-delivered fan-out is a no-op) and retry with backoff. */
export function maintenanceBulk(queue: Pick<Queue, 'addBulk'>, routed = false) {
  return {
    addBulk: (jobs: Parameters<Queue['addBulk']>[0]) =>
      queue.addBulk(
        jobs.map((j) => ({
          ...j,
          opts: {
            ...j.opts,
            ...(routed
              ? { ...ROUTED_RETRY }
              : { attempts: 3, backoff: { type: 'exponential' as const, delay: 5000 } }),
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
    /** Subscribers whose handlers run in another role: routed by the dispatcher, never run here. */
    routes?: readonly SubscriberRoute[];
    /** Per-org jobs whose handlers run in another role: fanned out here, queued for that role, never run here. */
    routedJobs?: readonly ScheduledRoute[];
  },
): { publish: Publish; running: Running } {
  const connection = connectionFor(redisUrl);
  const events = new Queue(EVENTS_QUEUE, { connection });
  const subscribers = new Queue(SUBSCRIBERS_QUEUE, { connection });
  // The ai-worker's subscribers are only routed from here: their handlers (and the AI dependencies) live in its image.
  const aiSubscribers = new Queue(AI_SUBSCRIBERS_QUEUE, { connection });
  const routes: readonly SubscriberRoute[] = [...registry, ...(scheduled.routes ?? [])];
  const dispatcher = new Worker<RelayedEvent>(
    EVENTS_QUEUE,
    (job) => dispatch(job.data, routes, subscribers, { ai: aiSubscribers }),
    { connection, concurrency: 20 },
  );
  const runner = subscriberRunner(connection, SUBSCRIBERS_QUEUE, database, registry, 10);

  // Scheduled jobs: one repeatable fan-out per job (a fixed scheduler id keeps it to one instance cluster-wide),
  // then one maintenance job per org that runs as that org.
  const scheduler = new Queue(SCHEDULED_QUEUE, { connection });
  const maintenance = new Queue(MAINTENANCE_QUEUE, { connection });
  const aiMaintenance = new Queue(AI_MAINTENANCE_QUEUE, { connection });
  const routedJobs = scheduled.routedJobs ?? [];
  for (const job of [...scheduled.jobs, ...routedJobs]) {
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
      const routed = routedJobs.find((j) => j.name === job.name);
      const def = routed ?? scheduled.jobs.find((j) => j.name === job.name);
      if (!def) throw new Error(`No scheduled job ${job.name}`);
      const target = routed ? maintenanceBulk(aiMaintenance, true) : maintenanceBulk(maintenance);
      const orgs = await fanOut(scheduled.platform, target, def, new Date());
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
          aiSubscribers.close(),
          scheduler.close(),
          maintenance.close(),
          aiMaintenance.close(),
        ]);
      },
    },
  };
}
