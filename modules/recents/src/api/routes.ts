import { defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { RecentsService } from '../application/recents';

export function recentsRoutes(database: Database, service: RecentsService) {
  return defineRoutes({
    listRecentViews: async (input) => ({
      status: 200,
      body: await database.withTenantTx(
        requireTenant(input),
        (s) => service.list(s, { projectId: input.query.projectId, limit: input.query.limit }),
        { readOnly: true },
      ),
    }),
    recordRecentView: async (input) => {
      await database.withTenantTx(requireTenant(input), (s) => service.record(s, input.body));
      return { status: 204 };
    },
  });
}
