// The ai-worker (WORKER_ROLE=ai): the process that holds Nova's heavy dependencies and does the AI work the default
// worker cannot. Today that is keeping the index in step with RFIs, defects and diary days (src/ai/reindex.ts) and with the folder
// and current revision of documents and drawing sheets (src/ai/restamp.ts).
// It has no relay, dispatcher or scheduled jobs: the default worker routes events to `subscribers-ai`, this one
// consumes them. Runs from its own image (Dockerfile target ai-worker); bundled apart from `main.ts` so the default
// image never loads pdfjs-dist or argon2.
import { Queue, Worker } from 'bullmq';
import { createDatabase, createLogger } from '@archova/kernel';
import { loadAiWorkerConfig } from './ai/config';
import { loadAiWorkerModules, reindexDepsFrom } from './ai/modules';
import { createReindex, REINDEX_QUEUE, type ReindexJob } from './ai/reindex';
import { watchQueueAge } from './ai/queue-age';
import { createRestamp } from './ai/restamp';
import { createSweep, type SweepJob } from './ai/sweep';
import {
  AI_MAINTENANCE_QUEUE,
  AI_SUBSCRIBERS_QUEUE,
  cappedBackoff,
  connectionFor,
  subscriberRunner,
} from './queues';

async function main() {
  const log = createLogger('ai-worker');
  const config = loadAiWorkerConfig();
  const database = createDatabase(config.databaseUrl);

  const modules = await loadAiWorkerModules(database, log, config);

  const connection = connectionFor(config.redisUrl);
  const reindexQueue = new Queue<ReindexJob>(REINDEX_QUEUE, { connection });
  const reindex = createReindex({
    ...reindexDepsFrom(database, modules),
    queue: reindexQueue,
    log: (msg, o) => log.info(o, msg),
  });

  const restamp = createRestamp({ ai: modules.ai.api, log: (msg, o) => log.info(o, msg) });
  const subscribers = [reindex.subscriber, restamp.subscriber];

  // Jobs here are queued with the `capped` backoff (queues.ts `ROUTED_RETRY`), which only these workers know.
  const settings = { backoffStrategy: cappedBackoff };
  const events = subscriberRunner(
    connection,
    AI_SUBSCRIBERS_QUEUE,
    database,
    subscribers,
    10,
    settings,
  );
  // Embedding is the slow, billable step: few at a time, and the gateway applies the org's own limits.
  const embedder = new Worker<ReindexJob>(REINDEX_QUEUE, (job) => reindex.reindex(job.data), {
    connection,
    concurrency: 2,
    settings,
  });
  // The nightly backstop (the default worker fans it out per org): a project at a time, no model call.
  const sweep = createSweep({ ai: modules.ai.api, log: (msg, o) => log.info(o, msg) });
  const sweeper = new Worker<SweepJob>(AI_MAINTENANCE_QUEUE, (job) => sweep(job.data), {
    connection,
    concurrency: 2,
    settings,
  });
  // Jeff alerts on this line: a re-stamp or drop that waits is stale access still searchable.
  const eventsQueue = new Queue(AI_SUBSCRIBERS_QUEUE, { connection });
  const stopWatching = watchQueueAge(eventsQueue, log);
  for (const w of [events, embedder, sweeper])
    w.on('failed', (job, err) =>
      log.error({ queue: w.name, job: job?.name, failure: err.message }, 'ai job failed'),
    );

  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  log.info({ subscribers: subscribers.map((s) => s.name) }, 'ai-worker started');
  await new Promise<void>((resolve) => stop.signal.addEventListener('abort', () => resolve()));

  stopWatching();
  await Promise.all([events.close(), embedder.close(), sweeper.close()]);
  await Promise.all([reindexQueue.close(), eventsQueue.close()]);
  await database.close();
}

main().catch((err) => {
  createLogger('ai-worker').fatal({ err }, 'ai-worker crashed');
  process.exit(1);
});
