import { defineModule, type KernelServices, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { plantRoutes } from './api/routes';
import { createConditionService, type ConditionDeps } from './application/condition';
import { createPlantService, PLANT_TIME_ZONE, type PlantDeps } from './application/plant';
import { postHireCosts, type PostPlantCost } from './application/postings';
import { PLANT_PERMISSIONS } from './permissions';

/** Plant and equipment: the org's fleet, where each machine is allocated, its maintenance and Nova's flags. */
export function createPlantModule(
  services: KernelServices,
  deps: {
    access: AccessService;
    files: ConditionDeps['files'];
    postCost: PostPlantCost;
    requireProject: PlantDeps['requireProject'];
    costCodeBudgeted: PlantDeps['costCodeBudgeted'];
    now?: () => Date;
  },
) {
  const plant = createPlantService(deps);
  const condition = createConditionService(deps, PLANT_TIME_ZONE);
  return {
    definition: defineModule({ name: 'plant', permissions: PLANT_PERMISSIONS }),
    routes: plantRoutes(services.database, plant, condition),
    api: {
      /** Posts the hire cost of finished days to project budgets (also run daily by the worker). */
      postHireCosts: (scope: TenantScope) =>
        postHireCosts(scope, plant.today(), deps.postCost, deps.access),
    },
  };
}

export type PlantModule = ReturnType<typeof createPlantModule>;
