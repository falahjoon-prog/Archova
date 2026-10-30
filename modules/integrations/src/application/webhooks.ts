import { and, asc, desc, eq, lte, min, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import { createTokenVault, type TokenVault } from '../domain/accounting/tokens';
import {
  PUBLIC_EVENT_TYPES,
  TEST_EVENT_TYPE,
  isPublicEventType,
  type WebhookPayload,
} from '../domain/webhooks/events';
import { retryDelayS, shouldAbandon } from '../domain/webhooks/retry';
import { newWebhookSecret, webhookHeaders } from '../domain/webhooks/signing';
import { webhookUrlProblem } from '../domain/webhooks/url-safety';
import { webhookDeliveries, webhookSubscriptions } from '../infra/tables';
import type { WebhookResult, WebhookTransport } from '../infra/webhook-transport';

export type SubscriptionRow = typeof webhookSubscriptions.$inferSelect;
export type DeliveryRow = typeof webhookDeliveries.$inferSelect;

const MAX_SUBSCRIPTIONS = 20;
/** Deliveries tried per pass; each is an outbound call of up to 10 s, held inside one transaction. */
const BATCH = 10;

export interface WebhooksDeps {
  vault: TokenVault;
  transport: WebhookTransport;
  now?: () => Date;
}

export interface CreateWebhookInput {
  url: string;
  description?: string | undefined;
  eventTypes: string[];
  projectIds?: string[] | undefined;
}

export const vaultFromKey = (base64Key: string) =>
  createTokenVault(Buffer.from(base64Key, 'base64'));

/** A 2xx is a success; 410 Gone also tells us to stop (integrations/06 §5). */
const ok = (r: WebhookResult) => r.status !== null && r.status >= 200 && r.status < 300;

export function createWebhookService(deps: WebhooksDeps) {
  const now = () => (deps.now ?? (() => new Date()))();

  function post(secret: string, url: string, p: WebhookPayload) {
    const body = JSON.stringify(p);
    return deps.transport.send({ url, headers: webhookHeaders(secret, p.id, now(), body), body });
  }

  /** Checks the URL and types, then proves the endpoint answers a signed test event with a 2xx. No transaction open. */
  async function prepare(orgId: string, input: CreateWebhookInput) {
    const problem = webhookUrlProblem(input.url);
    if (problem)
      throw new AppError('validation_failed', problem, [{ path: 'url', message: problem }]);
    const bad = input.eventTypes.filter((t) => !isPublicEventType(t));
    if (bad.length)
      throw new AppError(
        'webhook.invalid_event_type',
        `Not a public event type: ${bad.join(', ')}.`,
      );
    const secret = newWebhookSecret();
    const result = await post(secret, input.url, {
      id: uuidv7(),
      type: TEST_EVENT_TYPE,
      orgId,
      projectId: null,
      entityType: 'webhook',
      entityId: 'test',
      entityVersion: null,
      occurredAt: now().toISOString(),
    });
    if (!ok(result))
      throw new AppError(
        'webhook.verification_failed',
        `The endpoint did not answer the test event with a 2xx (${result.status ?? result.error ?? 'no answer'}).`,
      );
    return { secret };
  }

  async function create(
    scope: TenantScope,
    ownerUserId: string,
    input: CreateWebhookInput,
    secret: string,
  ) {
    const existing = await scope.tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions);
    if (existing.length >= MAX_SUBSCRIPTIONS)
      throw new AppError('webhook.limit_reached', 'Delete a webhook before adding another.');
    const [row] = await scope.tx
      .insert(webhookSubscriptions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        ownerUserId,
        url: input.url,
        description: input.description?.trim() || null,
        eventTypes: [...new Set(input.eventTypes)],
        projectIds: input.projectIds?.length ? input.projectIds : null,
        secretSealed: deps.vault.seal(scope.ctx.orgId, secret),
        createdAt: now(),
        updatedAt: now(),
      })
      .returning();
    return row!;
  }

  const list = (scope: TenantScope) =>
    scope.tx.select().from(webhookSubscriptions).orderBy(desc(webhookSubscriptions.createdAt));

  async function remove(scope: TenantScope, id: string) {
    const [sub] = await scope.tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id));
    if (!sub) throw new AppError('webhook.not_found');
    await scope.tx.delete(webhookDeliveries).where(eq(webhookDeliveries.subscriptionId, id));
    await scope.tx.delete(webhookSubscriptions).where(eq(webhookSubscriptions.id, id));
  }

  async function deliveries(scope: TenantScope, id: string, limit = 50) {
    const [sub] = await scope.tx
      .select({ id: webhookSubscriptions.id })
      .from(webhookSubscriptions)
      .where(eq(webhookSubscriptions.id, id));
    if (!sub) throw new AppError('webhook.not_found');
    return scope.tx
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.subscriptionId, id))
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(limit);
  }

  /** Records a delivery for every active subscription the event matches. Idempotent on (subscription, event). */
  async function fanOut(scope: TenantScope, event: WebhookPayload): Promise<number> {
    if (!isPublicEventType(event.type)) return 0;
    const subs = await scope.tx
      .select()
      .from(webhookSubscriptions)
      .where(
        and(
          eq(webhookSubscriptions.status, 'active'),
          sql`${event.type} = any(${webhookSubscriptions.eventTypes})`,
          sql`(${webhookSubscriptions.projectIds} is null or ${event.projectId}::uuid = any(${webhookSubscriptions.projectIds}))`,
        ),
      );
    if (!subs.length) return 0;
    const at = now();
    const inserted = await scope.tx
      .insert(webhookDeliveries)
      .values(
        subs.map((s) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          subscriptionId: s.id,
          eventId: event.id,
          eventType: event.type,
          payload: event,
          nextAttemptAt: at,
          createdAt: at,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: webhookDeliveries.id });
    return inserted.length;
  }

  /**
   * Tries the deliveries that are due. Success closes one; a failure schedules the next try (30 s … 6 h); 72 hours after
   * the event, or a 410, the subscription is disabled. Returns counts for the log and when the next pending delivery is due.
   */
  async function attemptDue(scope: TenantScope) {
    const at = now();
    const due = await scope.tx
      .select()
      .from(webhookDeliveries)
      .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, at)))
      .orderBy(asc(webhookDeliveries.nextAttemptAt))
      .limit(BATCH)
      .for('update', { skipLocked: true });
    const subs = new Map(
      (await scope.tx.select().from(webhookSubscriptions)).map((s) => [s.id, s] as const),
    );
    const counts = { delivered: 0, retried: 0, abandoned: 0 };
    for (const d of due) {
      const s = subs.get(d.subscriptionId)!;
      if (s.status === 'disabled') {
        await scope.tx
          .update(webhookDeliveries)
          .set({ status: 'abandoned', lastError: 'subscription disabled' })
          .where(eq(webhookDeliveries.id, d.id));
        counts.abandoned++;
        continue;
      }
      const secret = deps.vault.open(scope.ctx.orgId, s.secretSealed);
      const result = await post(secret, s.url, d.payload);
      const attempts = d.attempts + 1;
      if (ok(result)) {
        await scope.tx
          .update(webhookDeliveries)
          .set({
            status: 'succeeded',
            attempts,
            lastStatus: result.status,
            lastError: null,
            deliveredAt: now(),
          })
          .where(eq(webhookDeliveries.id, d.id));
        counts.delivered++;
        continue;
      }
      const gone = result.status === 410;
      const giveUp = gone || shouldAbandon(d.createdAt, now());
      await scope.tx
        .update(webhookDeliveries)
        .set({
          attempts,
          lastStatus: result.status,
          lastError: result.error ?? `HTTP ${result.status}`,
          ...(giveUp
            ? { status: 'abandoned' as const }
            : { nextAttemptAt: new Date(now().getTime() + retryDelayS(attempts) * 1000) }),
        })
        .where(eq(webhookDeliveries.id, d.id));
      if (giveUp) {
        counts.abandoned++;
        await scope.tx
          .update(webhookSubscriptions)
          .set({
            status: 'disabled',
            disabledReason: gone
              ? 'The endpoint answered 410 Gone.'
              : 'No successful delivery for 72 hours.',
            updatedAt: now(),
          })
          .where(eq(webhookSubscriptions.id, s.id));
      } else counts.retried++;
    }
    const [next] = await scope.tx
      .select({ at: min(webhookDeliveries.nextAttemptAt) })
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.status, 'pending'));
    return { ...counts, nextAt: next?.at ?? null };
  }

  return { prepare, create, list, remove, deliveries, fanOut, attemptDue };
}

export type WebhookService = ReturnType<typeof createWebhookService>;
export { PUBLIC_EVENT_TYPES };
