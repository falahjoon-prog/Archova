import { defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { SearchService } from '../application/search';

export function searchRoutes(database: Database, search: SearchService) {
  return defineRoutes({
    searchOrg: async (input) => ({
      status: 200,
      body: await database.withTenantTx(
        requireTenant(input),
        (s) => search.search(s, { q: input.query.q, perType: input.query.perType ?? 8 }),
        { readOnly: true },
      ),
    }),
  });
}
