import { defineModule, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { plantRoutes } from './api/routes';
import { createPlantService } from './application/plant';
import { PLANT_PERMISSIONS } from './permissions';

/** Plant and equipment: the org's fleet, where each machine is allocated, its maintenance and Nova's flags. */
export function createPlantModule(
  services: KernelServices,
  deps: { access: AccessService; now?: () => Date },
) {
  const plant = createPlantService(deps);
  return {
    definition: defineModule({ name: 'plant', permissions: PLANT_PERMISSIONS }),
    routes: plantRoutes(services.database, plant),
  };
}

export type PlantModule = ReturnType<typeof createPlantModule>;
