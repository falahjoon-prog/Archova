import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import type { Database } from '@archova/kernel';
import type { Publish, RelayedEvent } from './relay';
import { loadEvent, subscribersFor, subscriberJobId, type Subscriber } from './subscribers';

export const EVENTS_QUEUE = 'events';
export const SUBSCRIBERS_QUEUE = 'subscribers';

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

export interface Running {
  close(): Promise<void>;
}

export function startQueues(
  redisUrl: string,
  database: Database,
  registry: readonly Subscriber[],
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
  return {
    publish: eventsPublisher(events),
    running: {
      async close() {
        await Promise.all([dispatcher.close(), runner.close()]);
        await Promise.all([events.close(), subscribers.close()]);
      },
    },
  };
}
