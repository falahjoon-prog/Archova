import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { logisticsRoutes } from './api/routes';
import { createLogisticsService, type LogisticsDeps } from './application/deliveries';
import { LOGISTICS_PERMISSIONS } from './permissions';

/** Material delivery scheduling: docks, cranes and hoists, delivery windows, gate check-in and Nova's rule-based flags. */
export function createLogisticsModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    platform: Pick<PlatformApi, 'getProject'>;
    purchaseOrder: LogisticsDeps['purchaseOrder'];
    now?: () => Date;
  },
) {
  const service = createLogisticsService(deps);
  return {
    definition: defineModule({ name: 'logistics', permissions: LOGISTICS_PERMISSIONS }),
    routes: logisticsRoutes(services.database, service),
  };
}

export type LogisticsModule = ReturnType<typeof createLogisticsModule>;
