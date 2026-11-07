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
import { createDrainService, type AccessStateLookup } from './application/drain';
import { createPullService } from './application/pull';
import { createReviewService } from './application/review';
import { createPushService } from './application/push';

export interface SyncDeps {
  access: Pick<AccessService, 'can'>;
  /** What each module offers the pull; a module absent here is skipped when a device asks for it. */
  sources: readonly SyncSource[];
  /** The use cases a device may queue offline; a command absent here is rejected. */
  commands: readonly SyncCommand[];
  /** How someone's access to a project stands (platform); lets the pull hand out drain grants (X38). */
  accessState: AccessStateLookup;
}

export function createSyncModule(services: KernelServices, deps: SyncDeps) {
  const drain = createDrainService({
    database: services.database,
    commands: deps.commands,
    accessState: deps.accessState,
  });
  const pull = createPullService({
    ...deps,
    drain: { service: drain, accessState: deps.accessState },
  });
  const push = createPushService({ database: services.database, commands: deps.commands });
  const review = createReviewService({ commands: deps.commands });
  return {
    definition: defineModule({ name: 'sync', permissions: SYNC_PERMISSIONS }),
    routes: syncRoutes(services.database, pull, push, review, drain),
    /** `drain`: the late-submission queue (X38). The API pipeline calls `handle` for a drain-grant Bearer on `syncPush`. */
    api: { drain, review },
  };
}

export { isDrainToken, DRAIN_WINDOW_MS } from './application/drain';
export { SYNC_PERMISSIONS } from './permissions';
export { purgeSyncHolds, SYNC_RETENTION_DAYS, type SyncPurgeResult } from './application/retention';
