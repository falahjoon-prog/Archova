import { sql } from 'drizzle-orm';
import type { Database, TenantContext } from '@archova/kernel';
import type { RelayedEvent } from './relay';

/** The full outbox row, read as a tenant (app_rw), never by the relay. */
export interface StoredEvent extends RelayedEvent {
  projectId: string | null;
  entityType: string;
  entityId: string;
  entityVersion: number | null;
  actor: unknown;
  data: unknown;
  traceId: string | null;
  occurredAt: string;
}

/** Where the dispatcher sends an event for a subscriber: the default worker's runner, or another role's queue. */
export type SubscriberQueue = 'ai';

/** What the dispatcher needs to route an event; the handler lives wherever the subscriber's queue is consumed. */
export interface SubscriberRoute {
  /** Unique; part of the job id, so renaming one re-delivers history. */
  name: string;
  /** Exact type (`defects.defect.created.v1`) or a prefix ending in `*` (`defects.*`). */
  types: readonly string[];
  /** Absent: the default worker runs it. `ai`: the ai-worker does (its image alone carries the AI dependencies). */
  queue?: SubscriberQueue;
}

export interface Subscriber extends SubscriberRoute {
  /** At-least-once: must be idempotent on `event.id`. */
  handle(event: StoredEvent, ctx: { database: Database }): Promise<void>;
}

export function matches(subscriber: SubscriberRoute, type: string): boolean {
  return subscriber.types.some((t) =>
    t.endsWith('*') ? type.startsWith(t.slice(0, -1)) : t === type,
  );
}

/** Subscribers named in the registry whose types match; throws on duplicate names so a typo can't shadow one. */
export function subscribersFor<S extends SubscriberRoute>(
  registry: readonly S[],
  type: string,
): S[] {
  const names = new Set<string>();
  for (const s of registry) {
    if (names.has(s.name)) throw new Error(`Duplicate subscriber ${s.name}`);
    names.add(s.name);
  }
  return registry.filter((s) => matches(s, type));
}

/** BullMQ rejects ':' in custom ids, so the doc's `eventId:subscriber` is `eventId.subscriber`. */
export const subscriberJobId = (eventId: string, subscriber: string) => `${eventId}.${subscriber}`;

/** Jobs run as the org with no user, in the same tenant transaction the API uses. */
export function jobContext(orgId: string, requestId: string): TenantContext {
  return {
    orgId,
    userId: '00000000-0000-0000-0000-000000000000',
    principalType: 'member',
    orgRole: null,
    entitlements: { plan: 'system', state: 'active', modules: [], limits: {} },
    requestId,
  };
}

export async function loadEvent(
  database: Database,
  orgId: string,
  eventId: string,
): Promise<StoredEvent | null> {
  return database.withTenantTx(jobContext(orgId, `event:${eventId}`), async ({ tx }) => {
    const res = await tx.execute<{
      id: string;
      org_id: string;
      type: string;
      project_id: string | null;
      entity_type: string;
      entity_id: string;
      entity_version: number | null;
      actor: unknown;
      data: unknown;
      trace_id: string | null;
      occurred_at: Date | string;
    }>(sql`select * from shared.outbox where id = ${eventId}`);
    const r = res.rows[0];
    if (!r) return null;
    return {
      id: r.id,
      orgId: r.org_id,
      type: r.type,
      projectId: r.project_id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityVersion: r.entity_version,
      actor: r.actor,
      data: r.data,
      traceId: r.trace_id,
      occurredAt: new Date(r.occurred_at).toISOString(),
    };
  });
}
