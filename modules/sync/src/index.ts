// Public interface of @archova/mod-sync: the mobile offline sync endpoints (backend 04 §4, api.md §7).
import { defineModule } from '@archova/kernel';
import { syncRoutes } from './api/routes';

export function createSyncModule() {
  return {
    definition: defineModule({ name: 'sync' }),
    routes: syncRoutes(),
    api: {},
  };
}
