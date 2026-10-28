import { sql, type SQL } from 'drizzle-orm';
import type { SyncPullResponse } from '@archova/contracts';
import { encodeId } from '@archova/domain';
import type { SyncSource, TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { ParsedScopes } from '../domain/scopes';

export interface PullDeps {
  access: Pick<AccessService, 'can'>;
  sources: readonly SyncSource[];
}

type FeedRow = {
  seq: string;
  project_id: string | null;
  module: string;
  entity_type: string;
  entity_id: string;
  op: 'upsert' | 'delete';
  version: number | null;
};

const LOAD_CHUNK = 500;

/**
 * Mobile pull (backend 04 §4). Reads the change feed after `since` for the scopes the caller may still read, asks
 * each module's source for the records as this caller may see them, and reports what the caller lost.
 */
export function createPullService(deps: PullDeps) {
  const sources = new Map(deps.sources.map((s) => [s.module, s]));

  async function pull(
    scope: TenantScope,
    req: { scopes: ParsedScopes; since: number; limit: number },
  ): Promise<SyncPullResponse> {
    const revokedScopes: SyncPullResponse['revokedScopes'] = [];
    /** `project -> modules` the caller can read now; `null` project is the org scope. */
    const allowed = new Map<string | null, string[]>();

    for (const p of req.scopes.projects) {
      const known = p.modules.filter((m) => sources.has(m));
      if (known.length === 0) continue;
      if (!(await deps.access.can(scope, 'platform.projects.read', { projectId: p.projectId }))) {
        revokedScopes.push({ projectId: encodeId('project', p.projectId), module: null });
        continue;
      }
      const readable: string[] = [];
      for (const m of known) {
        const permission = sources.get(m)!.permission;
        if (
          permission === null ||
          (await deps.access.can(scope, permission, { projectId: p.projectId }))
        )
          readable.push(m);
        else revokedScopes.push({ projectId: encodeId('project', p.projectId), module: m });
      }
      if (readable.length > 0) allowed.set(p.projectId, readable);
    }
    if (req.scopes.org) {
      const orgModules = deps.sources.filter((s) => s.permission === null).map((s) => s.module);
      if (orgModules.length > 0) allowed.set(null, orgModules);
    }

    // Writers hold the org's sequence row until they commit, so every seq up to this value is visible.
    const latestRes = await scope.tx.execute<{ last_seq: string }>(
      sql`select last_seq from shared.org_sequences where org_id = ${scope.ctx.orgId}`,
    );
    const latest = Number(latestRes.rows[0]?.last_seq ?? 0);
    if (allowed.size === 0 || latest <= req.since)
      return {
        changes: [],
        revokedScopes,
        nextSince: String(Math.max(latest, req.since)),
        hasMore: false,
      };

    const where: SQL[] = [];
    for (const [projectId, modules] of allowed) {
      const mods = sql.join(
        modules.map((m) => sql`${m}`),
        sql`, `,
      );
      where.push(
        projectId === null
          ? sql`(project_id is null and module in (${mods}))`
          : sql`(project_id = ${projectId} and module in (${mods}))`,
      );
    }
    const feed = await scope.tx.execute<FeedRow>(sql`
      select seq, project_id, module, entity_type, entity_id, op, version
      from shared.change_feed
      where org_id = ${scope.ctx.orgId} and seq > ${req.since} and seq <= ${latest}
        and op in ('upsert', 'delete') and (${sql.join(where, sql` or `)})
      order by seq
      limit ${req.limit + 1}`);
    const hasMore = feed.rows.length > req.limit;
    const rows = hasMore ? feed.rows.slice(0, req.limit) : feed.rows;
    const nextSince = hasMore ? Number(rows[rows.length - 1]!.seq) : latest;

    // Only the last word on each record matters to the device.
    const last = new Map<string, FeedRow>();
    for (const r of rows) {
      const key = `${r.project_id}|${r.entity_type}|${r.entity_id}`;
      last.delete(key);
      last.set(key, r);
    }

    const groups = new Map<string, FeedRow[]>();
    for (const r of last.values()) {
      if (r.op !== 'upsert') continue;
      const key = `${r.module}|${r.project_id}|${r.entity_type}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const loaded = new Map<string, { version: number; data: Record<string, unknown> }>();
    for (const [key, group] of groups) {
      const first = group[0]!;
      const source = sources.get(first.module)!;
      for (let i = 0; i < group.length; i += LOAD_CHUNK) {
        const found = await source.load(scope, {
          projectId: first.project_id,
          entityType: first.entity_type,
          ids: group.slice(i, i + LOAD_CHUNK).map((r) => r.entity_id),
        });
        for (const [id, rec] of found) loaded.set(`${key}|${id}`, rec);
      }
    }

    const changes: SyncPullResponse['changes'] = [];
    for (const r of last.values()) {
      const source = sources.get(r.module)!;
      const id = source.publicId(r.entity_type, r.entity_id);
      const rec =
        r.op === 'upsert'
          ? loaded.get(`${r.module}|${r.project_id}|${r.entity_type}|${r.entity_id}`)
          : undefined;
      changes.push(
        rec
          ? { entityType: r.entity_type, id, op: 'upsert', version: rec.version, data: rec.data }
          : { entityType: r.entity_type, id, op: 'delete', version: r.version ?? 0 },
      );
    }
    return { changes, revokedScopes, nextSince: String(nextSince), hasMore };
  }

  return { pull };
}

export type PullService = ReturnType<typeof createPullService>;
