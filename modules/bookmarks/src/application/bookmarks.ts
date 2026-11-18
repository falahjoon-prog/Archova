import { and, count, desc, eq } from 'drizzle-orm';
import { decodeId, encodeId, uuidv7, type IdKind } from '@archova/domain';
import type { Bookmark, BookmarkList, BookmarkInput } from '@archova/contracts';
import { AppError, type TenantScope } from '@archova/kernel';
import { bookmarks, type BookmarkEntity } from '../infra/tables';

/** Most bookmarks one person can keep in an organisation; it keeps the list a shortcut, not an archive. */
export const MAX_BOOKMARKS = 200;

const ENTITY_KIND: Record<BookmarkEntity, IdKind> = {
  rfi: 'rfi',
  submittal: 'submittal',
  defect: 'defect',
  drawing_sheet: 'drawingSheet',
  meeting: 'meeting',
};

type Row = typeof bookmarks.$inferSelect;

function toApi(r: Row): Bookmark {
  return {
    id: encodeId('bookmark', r.id),
    entityType: r.entityType,
    entityId: encodeId(ENTITY_KIND[r.entityType], r.entityId),
    projectId: encodeId('project', r.projectId),
    title: r.title,
    subtitle: r.subtitle,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface BookmarkService {
  list(scope: TenantScope, opts: { projectId?: string | undefined }): Promise<BookmarkList>;
  save(scope: TenantScope, input: BookmarkInput): Promise<Bookmark>;
  remove(scope: TenantScope, publicId: string): Promise<void>;
}

/** Bookmarks are private: every query is for the caller's own rows, so another person's id is simply gone. */
export function createBookmarkService(): BookmarkService {
  const mine = (scope: TenantScope) =>
    and(eq(bookmarks.orgId, scope.ctx.orgId), eq(bookmarks.userId, scope.ctx.userId));

  return {
    async list(scope, { projectId }) {
      const projectUuid = projectId ? decodeId('project', projectId) : null;
      if (projectId && !projectUuid) return { data: [] };
      const rows = await scope.tx
        .select()
        .from(bookmarks)
        .where(and(mine(scope), projectUuid ? eq(bookmarks.projectId, projectUuid) : undefined))
        .orderBy(desc(bookmarks.createdAt), desc(bookmarks.id))
        .limit(MAX_BOOKMARKS);
      return { data: rows.map(toApi) };
    },

    /** Saving the same record twice keeps one bookmark and refreshes its title. */
    async save(scope, input) {
      const entityId = decodeId(ENTITY_KIND[input.entityType], input.entityId);
      const projectId = decodeId('project', input.projectId);
      if (!entityId || !projectId) throw new AppError('bookmark.invalid_target');
      const title = input.title.trim();
      if (!title) throw new AppError('bookmark.invalid_target');

      const [existing] = await scope.tx
        .select({ id: bookmarks.id })
        .from(bookmarks)
        .where(
          and(
            mine(scope),
            eq(bookmarks.entityType, input.entityType),
            eq(bookmarks.entityId, entityId),
          ),
        );
      if (!existing) {
        const [{ n } = { n: 0 }] = await scope.tx
          .select({ n: count() })
          .from(bookmarks)
          .where(mine(scope));
        if (n >= MAX_BOOKMARKS) throw new AppError('bookmark.limit_reached');
      }

      const [row] = await scope.tx
        .insert(bookmarks)
        .values({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          userId: scope.ctx.userId,
          projectId,
          entityType: input.entityType,
          entityId,
          title,
          subtitle: (input.subtitle ?? '').trim(),
        })
        .onConflictDoUpdate({
          target: [bookmarks.userId, bookmarks.entityType, bookmarks.entityId],
          set: { title, subtitle: (input.subtitle ?? '').trim(), projectId },
        })
        .returning();
      return toApi(row!);
    },

    /** Removing a bookmark that is already gone (or not yours) succeeds: the end state is the same. */
    async remove(scope, publicId) {
      const id = decodeId('bookmark', publicId);
      if (!id) return;
      await scope.tx.delete(bookmarks).where(and(mine(scope), eq(bookmarks.id, id)));
    },
  };
}
