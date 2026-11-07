import { defineModule, type Database } from '@archova/kernel';
import { searchRoutes } from './api/routes';
import { createSearchService, type SearchDeps } from './application/search';
import { SEARCH_PERMISSIONS } from './permissions';

/**
 * Global search: one box that looks for words across RFIs, documents, defects, submittals and correspondence in every
 * project the person can see. It stores nothing; it asks each tool module's own list (its own words index, its own
 * permission and visibility rules), so a row only appears if the person could open it there.
 */
export function createSearchModule(deps: SearchDeps & { database: Database }) {
  const search = createSearchService(deps);
  return {
    definition: defineModule({ name: 'search', permissions: SEARCH_PERMISSIONS }),
    routes: searchRoutes(deps.database, search),
    api: {},
  };
}

export type SearchModule = ReturnType<typeof createSearchModule>;
