import { sql } from 'drizzle-orm';
import type { Tx } from './db';

/**
 * One entry in the security audit log (security-licensing/07). `action` is a dotted verb (`auth.login.failed`,
 * `api_token.created`). `changes` is `{field: [before, after]}`. Never put a password, token, secret or free text
 * that may hold personal information in `changes` or `metadata`: the log is kept seven years and cannot be edited.
 */
export interface SecurityEvent {
  /** Null for an event with no org (a sign-in happens before an org is chosen): it joins the platform chain. */
  orgId: string | null;
  action: string;
  actorType: 'user' | 'api_client' | 'system' | 'support' | 'staff' | 'anonymous';
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  client?: 'web' | 'ios' | 'android' | 'api' | null;
  requestId?: string | null;
  changes?: Record<string, [unknown, unknown]>;
  metadata?: Record<string, unknown>;
}

/**
 * The org ids of the 16 platform chains that hold events with no org (sign-ins). Jobs that verify or anchor chains run
 * for each of these as well as for every live org.
 */
export const PLATFORM_AUDIT_SHARDS: readonly string[] = Array.from(
  { length: 16 },
  (_, n) => `00000000-0000-0000-0000-0000000000${n.toString(16).padStart(2, '0')}`,
);

/**
 * Appends an event to the security log in the caller's transaction, so the event exists if and only if the change it
 * describes commits. Works in any transaction: the database function does the chaining and alerting and is the only way
 * to write the log. `orgId` must be the org the transaction runs in, or null in one that has none (the database refuses
 * anything else). Returns the event id, or null when a flood of failed sign-ins was not stored.
 */
export async function recordSecurityEvent(tx: Tx, e: SecurityEvent): Promise<string | null> {
  const res = await tx.execute<{ id: string }>(sql`
    select audit.append_event(
      ${e.orgId}::uuid, ${e.actorType}, ${e.actorId ?? null}::uuid, ${e.action},
      ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.ip ?? null}, ${e.userAgent ?? null}, ${e.client ?? null},
      ${e.requestId ?? null}, ${JSON.stringify(e.changes ?? {})}::jsonb, ${JSON.stringify(e.metadata ?? {})}::jsonb
    ) as id`);
  return res.rows[0]?.id ?? null;
}
