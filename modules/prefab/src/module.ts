import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { prefabRoutes } from './api/routes';
import { createPrefabService, type PrefabDeps } from './application/units';
import { PREFAB_PERMISSIONS } from './permissions';

/** Prefabricated and modular construction: off-site units, QA gates, shipping and install schedule, and Nova's rule-based flags. */
export function createPrefabModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    platform: Pick<PlatformApi, 'getProject'>;
    files: PrefabDeps['files'];
    delivery: PrefabDeps['delivery'];
    createDelivery: PrefabDeps['createDelivery'];
    now?: () => Date;
  },
) {
  const service = createPrefabService(deps);
  return {
    definition: defineModule({ name: 'prefab', permissions: PREFAB_PERMISSIONS }),
    routes: prefabRoutes(services.database, service),
    api: {
      /** For `scheduling`: units tied to programme activities. */
      summariesByIds: service.summariesByIds,
    },
  };
}

export type PrefabModule = ReturnType<typeof createPrefabModule>;
