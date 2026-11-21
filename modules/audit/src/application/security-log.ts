import { encodeId } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import { sql } from 'drizzle-orm';

export const SECURITY_LOG_DEFAULT_LIMIT = 50;
export const SECURITY_LOG_MAX_LIMIT = 200;
const ACTION_RE = /^[a-z][a-z0-9_.]*$/;

export interface SecurityLogQuery {
  action?: string;
  actorId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

interface EventRow {
  id: string;
  seq: string;
  occurred_at: Date | string;
  occurred_text: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  client: string | null;
  changes: unknown;
}

function parseDate(value: string | undefined, path: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new AppError('validation_failed', 'Invalid date', [{ path, message: 'Invalid date' }]);
  return d;
}

/** Reads of the security log. Writes happen only through `recordSecurityEvent` (kernel). */
export function createSecurityLogService() {
  async function list(scope: TenantScope, q: SecurityLogQuery) {
    const limit = Math.min(
      Math.max(q.limit ?? SECURITY_LOG_DEFAULT_LIMIT, 1),
      SECURITY_LOG_MAX_LIMIT,
    );
    const after = decodeCursor<{ at: string; id: string }>(q.cursor);
    if (q.action && !ACTION_RE.test(q.action))
      throw new AppError('validation_failed', 'Invalid action', [
        { path: 'action', message: 'Invalid action' },
      ]);
    const from = parseDate(q.from, 'from');
    const to = parseDate(q.to, 'to');
    const where = [sql`org_id = ${scope.ctx.orgId}`];
    if (q.action) where.push(sql`(action = ${q.action} or action like ${q.action + '.%'})`);
    if (q.actorId) where.push(sql`actor_id = ${q.actorId}::uuid`);
    if (from) where.push(sql`occurred_at >= ${from.toISOString()}::timestamptz`);
    if (to) where.push(sql`occurred_at < ${to.toISOString()}::timestamptz`);
    if (after)
      where.push(sql`(occurred_at, id) < (${String(after.at)}::timestamptz, ${after.id}::uuid)`);
    const { rows } = await scope.tx.execute(sql`
      select id, seq::text, occurred_at, occurred_at::text as occurred_text, actor_type, actor_id, action,
             target_type, target_id, ip, client, changes
        from audit.security_events
       where ${sql.join(where, sql` and `)}
       order by occurred_at desc, id desc
       limit ${limit + 1}`);
    const page = toPage(rows as unknown as EventRow[], limit, (r) => ({
      at: r.occurred_text,
      id: r.id,
    }));
    return {
      nextCursor: page.nextCursor,
      data: page.data.map((r) => ({
        id: r.id,
        seq: Number(r.seq),
        at: new Date(r.occurred_at).toISOString(),
        action: r.action,
        actorType: r.actor_type,
        actorId: r.actor_id ? encodeId('user', r.actor_id) : null,
        targetType: r.target_type,
        targetId: r.target_id,
        ip: r.ip,
        client: r.client,
        changes: r.changes ?? {},
      })),
    };
  }

  async function alerts(scope: TenantScope, limit = 50) {
    const { rows } = await scope.tx.execute(sql`
      select id, rule, severity, summary, event_id, created_at
        from audit.alerts where org_id = ${scope.ctx.orgId}
       order by created_at desc, id desc limit ${Math.min(Math.max(limit, 1), 200)}`);
    return {
      data: (
        rows as unknown as Array<{
          id: string;
          rule: string;
          severity: string;
          summary: string;
          event_id: string | null;
          created_at: Date | string;
        }>
      ).map((r) => ({
        id: r.id,
        rule: r.rule,
        severity: r.severity,
        summary: r.summary,
        eventId: r.event_id,
        at: new Date(r.created_at).toISOString(),
      })),
    };
  }

  /** The newest verification and anchor, so an admin can see the log was checked and when it was last pinned. */
  async function integrity(scope: TenantScope) {
    const org = scope.ctx.orgId;
    const run = (
      await scope.tx.execute(sql`
        select ok, checked::text, first_bad_seq::text, problem, head_seq::text, ran_at
          from audit.verification_runs where org_id = ${org} order by ran_at desc limit 1`)
    ).rows[0] as
      | {
          ok: boolean;
          checked: string;
          first_bad_seq: string | null;
          problem: string | null;
          head_seq: string | null;
          ran_at: Date | string;
        }
      | undefined;
    const anchor = (
      await scope.tx.execute(sql`
        select seq::text, anchored_at, object_key from audit.chain_anchors
         where org_id = ${org} order by seq desc limit 1`)
    ).rows[0] as { seq: string; anchored_at: Date | string; object_key: string | null } | undefined;
    const head = (
      await scope.tx.execute(
        sql`select last_seq::text from audit.chain_heads where org_id = ${org}`,
      )
    ).rows[0] as { last_seq: string } | undefined;
    return {
      eventCount: Number(head?.last_seq ?? 0),
      lastVerification: run
        ? {
            ok: run.ok,
            checked: Number(run.checked),
            firstBadSeq: run.first_bad_seq === null ? null : Number(run.first_bad_seq),
            problem: run.problem,
            at: new Date(run.ran_at).toISOString(),
          }
        : null,
      lastAnchor: anchor
        ? {
            seq: Number(anchor.seq),
            at: new Date(anchor.anchored_at).toISOString(),
            writeOnce: anchor.object_key !== null,
          }
        : null,
    };
  }

  return { list, alerts, integrity };
}

export type SecurityLogService = ReturnType<typeof createSecurityLogService>;
