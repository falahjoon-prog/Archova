// The ai-worker (WORKER_ROLE=ai): the process that holds Nova's heavy dependencies and does the AI work the default
// worker cannot. Today that is keeping the index in step with RFIs, defects and diary days (src/ai/reindex.ts).
// It has no relay, dispatcher or scheduled jobs: the default worker routes events to `subscribers-ai`, this one
// consumes them. Runs from its own image (Dockerfile target ai-worker); bundled apart from `main.ts` so the default
// image never loads pdfjs-dist or argon2.
import { Queue, Worker } from 'bullmq';
import { createDatabase, createLogger } from '@archova/kernel';
import { loadAiWorkerConfig } from './ai/config';
import { loadAiWorkerModules, reindexDepsFrom } from './ai/modules';
import { createReindex, REINDEX_QUEUE, type ReindexJob } from './ai/reindex';
import { AI_SUBSCRIBERS_QUEUE, connectionFor, subscriberRunner } from './queues';

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

  const events = subscriberRunner(
    connection,
    AI_SUBSCRIBERS_QUEUE,
    database,
    [reindex.subscriber],
    10,
  );
  // Embedding is the slow, billable step: few at a time, and the gateway applies the org's own limits.
  const embedder = new Worker<ReindexJob>(REINDEX_QUEUE, (job) => reindex.reindex(job.data), {
    connection,
    concurrency: 2,
  });
  for (const w of [events, embedder])
    w.on('failed', (job, err) =>
      log.error({ queue: w.name, job: job?.name, err: err.message }, 'ai job failed'),
    );

  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  log.info({ subscribers: [reindex.subscriber.name] }, 'ai-worker started');
  await new Promise<void>((resolve) => stop.signal.addEventListener('abort', () => resolve()));

  await Promise.all([events.close(), embedder.close()]);
  await reindexQueue.close();
  await database.close();
}

main().catch((err) => {
  createLogger('ai-worker').fatal({ err }, 'ai-worker crashed');
  process.exit(1);
});
