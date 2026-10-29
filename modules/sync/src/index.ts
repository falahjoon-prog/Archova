// Public interface of @archova/mod-sync: the mobile offline sync endpoints (backend 04 §4, api.md §7).
import {
  defineModule,
  type KernelServices,
  type SyncCommand,
  type SyncSource,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { SYNC_PERMISSIONS } from './permissions';
import { syncRoutes } from './api/routes';
import { createDrainService } from './application/drain';
import { createPullService } from './application/pull';
import { createReviewService } from './application/review';
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
  const review = createReviewService({ commands: deps.commands });
  const drain = createDrainService({ database: services.database, commands: deps.commands });
  return {
    definition: defineModule({ name: 'sync', permissions: SYNC_PERMISSIONS }),
    routes: syncRoutes(services.database, pull, push, review),
    /** `drain`: the late-submission queue (X38). The API pipeline calls `handle` for a drain-grant Bearer on `syncPush`. */
    api: { drain, review },
  };
}

export { isDrainToken } from './application/drain';
export { SYNC_PERMISSIONS } from './permissions';
