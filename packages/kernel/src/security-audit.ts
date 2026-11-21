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
 * Appends an event to the security log in the caller's transaction, so the event exists if and only if the change it
 * describes commits. Works in any transaction (tenant or global): the database function does the chaining and alerting
 * and is the only way to write the log. Returns the event id.
 */
export async function recordSecurityEvent(tx: Tx, e: SecurityEvent): Promise<string> {
  const res = await tx.execute<{ id: string }>(sql`
    select audit.append_event(
      ${e.orgId}::uuid, ${e.actorType}, ${e.actorId ?? null}::uuid, ${e.action},
      ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.ip ?? null}, ${e.userAgent ?? null}, ${e.client ?? null},
      ${e.requestId ?? null}, ${JSON.stringify(e.changes ?? {})}::jsonb, ${JSON.stringify(e.metadata ?? {})}::jsonb
    ) as id`);
  return res.rows[0]!.id;
}
