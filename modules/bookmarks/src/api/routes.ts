import { defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { BookmarkService } from '../application/bookmarks';

export function bookmarksRoutes(database: Database, service: BookmarkService) {
  return defineRoutes({
    listBookmarks: async (input) => ({
      status: 200,
      body: await database.withTenantTx(
        requireTenant(input),
        (s) => service.list(s, { projectId: input.query.projectId }),
        { readOnly: true },
      ),
    }),
    saveBookmark: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireTenant(input), (s) => service.save(s, input.body)),
    }),
    deleteBookmark: async (input) => {
      await database.withTenantTx(requireTenant(input), (s) =>
        service.remove(s, input.params.bookmarkId),
      );
      return { status: 204 };
    },
  });
}
