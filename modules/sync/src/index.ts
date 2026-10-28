// Public interface of @archova/mod-sync: the mobile offline sync endpoints (backend 04 §4, api.md §7).
import {
  defineModule,
  type KernelServices,
  type SyncCommand,
  type SyncSource,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { syncRoutes } from './api/routes';
import { createPullService } from './application/pull';
import { createPushService } from './application/push';

export interface SyncDeps {
  access: Pick<AccessService, 'can'>;
  /** What each module offers the pull; a module absent here is skipped when a device asks for it. */
  sources: readonly SyncSource[];
  /** The use cases a device may queue offline; a command absent here is rejected. */
  commands: readonly SyncCommand[];
}

export function createSyncModule(services: KernelServices, deps: SyncDeps) {
  const pull = createPullService(deps);
  const push = createPushService({ database: services.database, commands: deps.commands });
  return {
    definition: defineModule({ name: 'sync' }),
    routes: syncRoutes(services.database, pull, push),
    api: {},
  };
}
