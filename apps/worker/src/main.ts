import pg from 'pg';
import { createDatabase, createLogger } from '@archova/kernel';
import { loadConfig } from './config';
import { startQueues } from './queues';
import { runRelay } from './relay';
import { accessLinkPurge } from './jobs/access-links';
import type { TenantJob } from './scheduler';
import type { Subscriber } from './subscribers';

/** Registered as the standard subscribers land (audit, notifications, search-index, ...; backend 05 §1). */
const SUBSCRIBERS: Subscriber[] = [];

/** Nightly and hourly per-org jobs (backend 05 §3). */
const JOBS: TenantJob[] = [accessLinkPurge];

async function main() {
  const log = createLogger('worker');
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  const platform = new pg.Pool({ connectionString: config.platformDatabaseUrl, max: 2 });
  const { publish, running } = startQueues(config.redisUrl, database, SUBSCRIBERS, {
    platform,
    jobs: JOBS,
    log: (msg, o) => log.info(o, msg),
  });

  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  log.info({ subscribers: SUBSCRIBERS.map((s) => s.name) }, 'worker started');
  await runRelay(platform, publish, stop.signal, {
    onError: (err) => log.error({ err }, 'relay pass failed'),
  });

  await running.close();
  await platform.end();
  await database.close();
}

main().catch((err) => {
  createLogger('worker').fatal({ err }, 'worker crashed');
  process.exit(1);
});
