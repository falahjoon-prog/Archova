import { and, desc, eq, notInArray } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type { RecentView, RecentViewInput, RecentViewList } from '@archova/contracts';
import { AppError, type TenantScope } from '@archova/kernel';
import { recentViews, type RecentEntity } from '../infra/tables';

/** Most views one person keeps in an organisation; older ones are dropped as new ones arrive. */
export const MAX_RECENTS = 50;
/** Most rows one list call returns. */
export const DEFAULT_LIMIT = 10;

const ENTITY_KIND: Record<RecentEntity, IdKind> = {
  rfi: 'rfi',
  submittal: 'submittal',
  defect: 'defect',
  drawing_sheet: 'drawingSheet',
  meeting: 'meeting',
};

type Row = typeof recentViews.$inferSelect;

function toApi(r: Row): RecentView {
  return {
    entityType: r.entityType,
    entityId: encodeId(ENTITY_KIND[r.entityType], r.entityId),
    projectId: encodeId('project', r.projectId),
    title: r.title,
    subtitle: r.subtitle,
    viewedAt: r.viewedAt.toISOString(),
  };
}

export interface RecentsService {
  list(
    scope: TenantScope,
    opts: { projectId?: string | undefined; limit?: number | undefined },
  ): Promise<RecentViewList>;
  record(scope: TenantScope, input: RecentViewInput): Promise<void>;
}

/** Recents are private: every query is for the caller's own rows. */
export function createRecentsService(): RecentsService {
  const mine = (scope: TenantScope) =>
    and(eq(recentViews.orgId, scope.ctx.orgId), eq(recentViews.userId, scope.ctx.userId));

  return {
    async list(scope, { projectId, limit }) {
      const projectUuid = projectId ? decodeId('project', projectId) : null;
      if (projectId && !projectUuid) return { data: [] };
      const rows = await scope.tx
        .select()
        .from(recentViews)
        .where(and(mine(scope), projectUuid ? eq(recentViews.projectId, projectUuid) : undefined))
        .orderBy(desc(recentViews.viewedAt), desc(recentViews.id))
        .limit(Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_RECENTS));
      return { data: rows.map(toApi) };
    },

    /** Viewing the same record again keeps one row, refreshes its title and moves it to the top. */
    async record(scope, input) {
      const entityId = decodeId(ENTITY_KIND[input.entityType], input.entityId);
      const projectId = decodeId('project', input.projectId);
      const title = input.title.trim();
      if (!entityId || !projectId || !title) throw new AppError('recent.invalid_target');
      const subtitle = (input.subtitle ?? '').trim();

      await scope.tx
        .insert(recentViews)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          userId: scope.ctx.userId,
          projectId,
          entityType: input.entityType,
          entityId,
          title,
          subtitle,
        })
        .onConflictDoUpdate({
          target: [recentViews.userId, recentViews.entityType, recentViews.entityId],
          set: { title, subtitle, projectId, viewedAt: new Date() },
        });

      // Keep the newest MAX_RECENTS rows.
      const keep = await scope.tx
        .select({ id: recentViews.id })
        .from(recentViews)
        .where(mine(scope))
        .orderBy(desc(recentViews.viewedAt), desc(recentViews.id))
        .limit(MAX_RECENTS);
      await scope.tx.delete(recentViews).where(
        and(
          mine(scope),
          notInArray(
            recentViews.id,
            keep.map((k) => k.id),
          ),
        ),
      );
    },
  };
}
