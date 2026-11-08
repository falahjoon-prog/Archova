import { defineModule, type KernelServices } from '@archova/kernel';
import { bookmarksRoutes } from './api/routes';
import { createBookmarkService } from './application/bookmarks';

/** Personal bookmarks: a person's own shortcuts to records in other modules. */
export function createBookmarksModule(services: KernelServices) {
  const service = createBookmarkService();
  return {
    definition: defineModule({ name: 'bookmarks', permissions: [] }),
    routes: bookmarksRoutes(services.database, service),
  };
}

export type BookmarksModule = ReturnType<typeof createBookmarksModule>;
