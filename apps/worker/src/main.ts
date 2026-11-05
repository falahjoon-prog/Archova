import { readFileSync } from 'node:fs';
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
import { bidReminders } from './jobs/bid-reminders';
import { trustReminders } from './jobs/trust-reminders';
import { incidentActionEmails } from './jobs/incident-action-emails';
import { incidentActionNotices } from './jobs/incident-action-notices';
import { meetingReminders } from './jobs/meeting-reminders';
import { importStagingPurge } from './jobs/import-staging';
import { syncHoldsPurge } from './jobs/sync-holds';
import { templateBackfill } from './jobs/template-backfill';
import { trialBackfill } from './jobs/trial-backfill';
import { trialEndingEmail } from './jobs/trial-ending-email';
import { createLogSender, createSesSender } from './email';
import { evidenceDeliveries } from './jobs/evidence-deliveries';
import { evidenceTimestamps } from './jobs/evidence-timestamps';
import { trialExpiry } from './jobs/trial-expiry';
import { threatMove } from './jobs/threat-move';
import type { TenantJob } from './scheduler';
import type { Subscriber } from './subscribers';
import { walletExpiry, walletExpiryNotices } from './jobs/wallet-expiry';
import { walletRetention } from './jobs/wallet-retention';
import { dataExportBuilder, dataExportNotices, dataExportSweep } from './jobs/data-exports';
import { webhookDelivery } from './webhooks';

/** Subscribers whose handlers run in another role's process: routed here, never run here. */
const ROUTES = AI_ROUTES;

function readTimestampCa(file: string | null): string {
  if (!file)
    throw new Error(
      'WORKER_EVIDENCE_TSA_URL needs WORKER_EVIDENCE_TSA_CA_FILE (pinned certificates)',
    );
  return readFileSync(file, 'utf8');
}

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
  const emailSender =
    config.email.provider === 'ses'
      ? createSesSender({
          region: config.email.region,
          from: config.email.from,
          replyTo: config.email.replyTo,
        })
      : createLogSender((msg, o) => log.info(o, msg));
  SUBSCRIBERS.push(dataExportNotices(emailSender, (msg, o) => log.info(o ?? {}, msg)));
  /** Nightly and hourly per-org jobs (backend 05 §3). */
  const jobs: TenantJob[] = [
    accessLinkPurge,
    importStagingPurge,
    syncHoldsPurge,
    trialExpiry,
    trialBackfill,
    trialEndingEmail(emailSender, config.email.appBaseUrl),
    // Sealed claims go out as real attachments or not at all: the log sender would mark them sent.
    ...(config.email.provider === 'ses' ? [evidenceDeliveries(emailSender)] : []),
    ...(config.evidenceTimestampUrl
      ? [
          evidenceTimestamps(
            config.evidenceTimestampUrl,
            readTimestampCa(config.evidenceTimestampCaFile),
            (msg, o) => log.warn(o, msg),
          ),
        ]
      : []),
    templateBackfill,
    meetingReminders,
    bidReminders,
    trustReminders,
    incidentActionNotices,
    incidentActionEmails(emailSender, config.email.appBaseUrl),
    // Alert rows are the record until the notification inbox lands; log what was raised.
    walletExpiry(walletExpiryNotices),
    walletRetention(),
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
    jobs.push(threatMove(store, log), dataExportSweep(store));
    SUBSCRIBERS.push(dataExportBuilder(store, (msg, o) => log.info(o ?? {}, msg)));
  } else {
    log.warn(
      {},
      'WORKER_FILES_STORE is not s3: file jobs (threat move, data export) are not scheduled',
    );
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
