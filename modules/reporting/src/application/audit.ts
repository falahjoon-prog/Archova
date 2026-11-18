import { encodeId, decodeId } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { PlatformApi } from '@archova/mod-platform';
import { sql } from 'drizzle-orm';
import {
  AUDIT_DEFAULT_LIMIT,
  AUDIT_MAX_LIMIT,
  actorKind,
  describeAction,
  parseEventType,
  type RawActor,
} from '../domain/audit';

export interface AuditDeps {
  platform: Pick<PlatformApi, 'listProjects'>;
  identity: Pick<IdentityApi, 'getUsers'>;
}

export interface AuditQuery {
  projectId?: string;
  module?: string;
  actorId?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

interface Row {
  id: string;
  type: string;
  project_id: string | null;
  entity_type: string;
  actor: RawActor | null;
  occurred_at: Date | string;
  occurred_text: string;
}

const MODULE_RE = /^[a-z][a-z0-9_]*$/;

function parseDate(value: string | undefined, path: string): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()))
    throw new AppError('validation_failed', 'Invalid date', [{ path, message: 'Invalid date' }]);
  return d;
}

/**
 * The audit log: who did what, when, across the org, read from the events every use case already writes to
 * `shared.outbox` in the same transaction as the change. Event payloads are never returned (they can hold personal
 * or commercial detail); a line is the action, the kind of record, the project, the person and the time. The
 * permission is org owner or admin only, so no per-project narrowing is needed.
 */
export function createAuditService(deps: AuditDeps) {
  async function list(scope: TenantScope, q: AuditQuery) {
    const limit = Math.min(Math.max(q.limit ?? AUDIT_DEFAULT_LIMIT, 1), AUDIT_MAX_LIMIT);
    const after = decodeCursor<{ at: string; id: string }>(q.cursor);
    const from = parseDate(q.from, 'from');
    const to = parseDate(q.to, 'to');
    let projectUuid: string | null = null;
    if (q.projectId) {
      projectUuid = decodeId('project', q.projectId);
      if (!projectUuid)
        throw new AppError('validation_failed', 'Invalid id', [
          { path: 'projectId', message: 'Invalid id' },
        ]);
    }
    let actorUuid: string | null = null;
    if (q.actorId) {
      actorUuid = decodeId('user', q.actorId);
      if (!actorUuid)
        throw new AppError('validation_failed', 'Invalid id', [
          { path: 'actorId', message: 'Invalid id' },
        ]);
    }
    if (q.module && !MODULE_RE.test(q.module))
      throw new AppError('validation_failed', 'Invalid module', [
        { path: 'module', message: 'Invalid module' },
      ]);

    const where = [sql`true`];
    if (projectUuid) where.push(sql`project_id = ${projectUuid}`);
    if (q.module) where.push(sql`type like ${q.module + '.%'}`);
    if (actorUuid) where.push(sql`actor->>'type' = 'user' and actor->>'id' = ${actorUuid}`);
    if (from) where.push(sql`occurred_at >= ${from.toISOString()}::timestamptz`);
    if (to) where.push(sql`occurred_at < ${to.toISOString()}::timestamptz`);
    if (after)
      where.push(sql`(occurred_at, id) < (${String(after.at)}::timestamptz, ${after.id}::uuid)`);

    const { rows } = await scope.tx.execute(sql`
      select id, type, project_id, entity_type, actor, occurred_at, occurred_at::text as occurred_text
      from shared.outbox
      where ${sql.join(where, sql` and `)}
      order by occurred_at desc, id desc
      limit ${limit + 1}`);
    const page = toPage(rows as unknown as Row[], limit, (r) => ({
      at: r.occurred_text,
      id: r.id,
    }));

    const userIds = [
      ...new Set(
        page.data.flatMap((r) => (r.actor?.type === 'user' && r.actor.id ? [r.actor.id] : [])),
      ),
    ];
    const users = userIds.length ? await deps.identity.getUsers(userIds) : new Map();
    const projects = await deps.platform.listProjects(scope, { limit: 200 });
    const projectNames = new Map(projects.data.map((p) => [p.id, p.name]));

    return {
      nextCursor: page.nextCursor,
      data: page.data.map((r) => {
        const { action, module } = parseEventType(r.type);
        const kind = actorKind(r.actor);
        return {
          id: encodeId('event', r.id),
          at: new Date(r.occurred_at).toISOString(),
          action,
          module,
          summary: describeAction(action),
          entityType: r.entity_type,
          projectId: r.project_id ? encodeId('project', r.project_id) : null,
          projectName: r.project_id ? (projectNames.get(r.project_id) ?? null) : null,
          actor: {
            kind,
            id: kind === 'user' && r.actor?.id ? encodeId('user', r.actor.id) : null,
            name: kind === 'user' ? (users.get(r.actor?.id ?? '')?.name ?? null) : null,
          },
        };
      }),
    };
  }
  return { list };
}

export type AuditService = ReturnType<typeof createAuditService>;
