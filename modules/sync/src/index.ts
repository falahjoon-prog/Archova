// Public interface of @archova/mod-sync: the mobile offline sync endpoints (backend 04 §4, api.md §7).
import { defineModule, type KernelServices, type SyncSource } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { syncRoutes } from './api/routes';
import { createPullService } from './application/pull';

export interface SyncDeps {
  access: Pick<AccessService, 'can'>;
  /** What each module offers the pull; a module absent here is skipped when a device asks for it. */
  sources: readonly SyncSource[];
}

export function createSyncModule(services: KernelServices, deps: SyncDeps) {
  const pull = createPullService(deps);
  return {
    definition: defineModule({ name: 'sync' }),
    routes: syncRoutes(services.database, pull),
    api: {},
  };
}
