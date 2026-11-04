import pg from 'pg';
import { createDatabase, createLogger } from '@archova/kernel';
import { createS3ObjectStore } from '@archova/mod-files';
import {
  createHttpsTransport,
  createWebhookService,
  vaultFromKey,
} from '@archova/mod-integrations';
import { AI_JOBS, AI_ROUTES } from './ai/declaration';
import { loadConfig, workerRole } from './config';
import { connectionFor, startQueues } from './queues';
import { runRelay } from './relay';
import { accessLinkPurge } from './jobs/access-links';
import { importStagingPurge } from './jobs/import-staging';
import { syncHoldsPurge } from './jobs/sync-holds';
import { templateBackfill } from './jobs/template-backfill';
import { trialBackfill } from './jobs/trial-backfill';
import { trialExpiry } from './jobs/trial-expiry';
import { threatMove } from './jobs/threat-move';
import type { TenantJob } from './scheduler';
import type { Subscriber } from './subscribers';
import { walletExpiry } from './jobs/wallet-expiry';
import { webhookDelivery } from './webhooks';

/** Subscribers whose handlers run in another role's process: routed here, never run here. */
const ROUTES = AI_ROUTES;

async function main() {
  const log = createLogger('worker');
  if (workerRole() === 'ai')
    throw new Error(
      'WORKER_ROLE=ai runs dist/ai.js (the ai-worker image), not the relay and dispatcher',
    );
  const config = loadConfig();
  const database = createDatabase(config.databaseUrl);
  /** Registered as the standard subscribers land (audit, notifications, search-index, ...; backend 05 §1). */
  const SUBSCRIBERS: Subscriber[] = [];
  /** Nightly and hourly per-org jobs (backend 05 §3). */
  const jobs: TenantJob[] = [
    accessLinkPurge,
    importStagingPurge,
    syncHoldsPurge,
    trialExpiry,
    trialBackfill,
    templateBackfill,
    // Alert rows are the record until the notification inbox lands; log what was raised.
    walletExpiry(async (scope, alerts) => {
      log.info({ orgId: scope.ctx.orgId, alerts: alerts.length }, 'wallet expiry alerts raised');
    }),
  ];
  let webhooks: ReturnType<typeof webhookDelivery> | null = null;
  if (config.webhookSecretKey) {
    webhooks = webhookDelivery(
      connectionFor(config.redisUrl),
      database,
      createWebhookService({
        vault: vaultFromKey(config.webhookSecretKey),
        transport: createHttpsTransport(),
      }),
      (msg, o) => log.info(o, msg),
    );
    SUBSCRIBERS.push(webhooks.fanOut);
    jobs.push(webhooks.sweep);
  } else {
    log.warn({}, 'WORKER_WEBHOOK_SECRET_KEY is not set: webhooks are not delivered');
  }
  if (config.files.store === 's3') {
    const store = createS3ObjectStore({
      bucket: config.files.bucket,
      region: config.files.region,
      ...(config.files.endpoint ? { endpoint: config.files.endpoint } : {}),
      ...(config.files.credentials ? { credentials: config.files.credentials } : {}),
    });
    jobs.push(threatMove(store, log));
  } else {
    log.warn({}, 'WORKER_FILES_STORE is not s3: file jobs (threat move) are not scheduled');
  }
  const platform = new pg.Pool({ connectionString: config.platformDatabaseUrl, max: 2 });
  const { publish, running } = startQueues(config.redisUrl, database, SUBSCRIBERS, {
    platform,
    jobs,
    routes: ROUTES,
    routedJobs: AI_JOBS,
    log: (msg, o) => log.info(o, msg),
  });

  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  log.info(
    { subscribers: SUBSCRIBERS.map((s) => s.name), routed: ROUTES.map((s) => s.name) },
    'worker started',
  );
  await runRelay(platform, publish, stop.signal, {
    onError: (err) => log.error({ err }, 'relay pass failed'),
  });

  await running.close();
  await webhooks?.close();
  await platform.end();
  await database.close();
}

main().catch((err) => {
  createLogger('worker').fatal({ err }, 'worker crashed');
  process.exit(1);
});
