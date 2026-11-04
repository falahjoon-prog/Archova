import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import {
  isPublicEventType,
  type WebhookPayload,
  type WebhookService,
} from '@archova/mod-integrations';
import type { Database } from '@archova/kernel';
import { jobContext, type Subscriber } from './subscribers';
import type { TenantJob } from './scheduler';

export const WEBHOOKS_QUEUE = 'webhooks';
export const WEBHOOK_FAN_OUT = 'webhooks.fan-out';
export const WEBHOOK_SWEEP = 'webhooks.sweep';

/**
 * Outbound webhooks (integrations/06 §5). A subscriber turns each public event into delivery rows and wakes a
 * per-org `deliver` job; that job sends what is due and schedules itself for the next retry. Retries run 30 s to 6 h
 * apart, which the scheduled-job clock (hourly at best) cannot do, so they get their own delayed jobs. An hourly sweep
 * restarts any org whose chain was lost (Redis flushed, job failed for good).
 */
export function webhookDelivery(
  connection: ConnectionOptions,
  database: Database,
  service: WebhookService,
  log: (msg: string, o: object) => void,
) {
  const queue = new Queue<{ orgId: string }>(WEBHOOKS_QUEUE, { connection });

  /** One job per org and due time, so a burst of events or a replay does not stack up duplicates. */
  const wake = (orgId: string, at: Date) =>
    queue.add(
      'deliver',
      { orgId },
      {
        jobId: `deliver.${orgId}.${Math.floor(at.getTime() / 1000)}`,
        delay: Math.max(0, at.getTime() - Date.now()),
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86_400 },
      },
    );

  async function run(orgId: string) {
    const r = await database.withTenantTx(jobContext(orgId, `webhooks.deliver:${orgId}`), (scope) =>
      service.attemptDue(scope),
    );
    if (r.nextAt) await wake(orgId, r.nextAt);
    return r;
  }

  const worker = new Worker<{ orgId: string }>(
    WEBHOOKS_QUEUE,
    async (job) => {
      const { nextAt: _nextAt, ...counts } = await run(job.data.orgId);
      if (counts.delivered || counts.retried || counts.abandoned)
        log('webhook deliveries', { orgId: job.data.orgId, ...counts });
    },
    { connection, concurrency: 5 },
  );

  const fanOut: Subscriber = {
    name: WEBHOOK_FAN_OUT,
    types: ['platform.*', 'documents.*', 'rfis.*', 'submittals.*', 'diary.*', 'defects.*'],
    async handle(event, { database: db }) {
      if (!isPublicEventType(event.type)) return;
      // Notification only: ids and version, never `data` (the consumer re-fetches under its own access).
      const payload: WebhookPayload = {
        id: event.id,
        type: event.type,
        orgId: event.orgId,
        projectId: event.projectId,
        entityType: event.entityType,
        entityId: event.entityId,
        entityVersion: event.entityVersion,
        occurredAt: event.occurredAt,
      };
      const n = await db.withTenantTx(
        jobContext(event.orgId, `webhooks.fan-out:${event.id}`),
        (scope) => service.fanOut(scope, payload),
      );
      if (n > 0) await wake(event.orgId, new Date());
    },
  };

  const sweep: TenantJob = {
    name: WEBHOOK_SWEEP,
    cron: '20 * * * *',
    async run(_db, orgId) {
      const { nextAt: _nextAt, ...counts } = await run(orgId);
      return counts;
    },
  };

  return {
    fanOut,
    sweep,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
