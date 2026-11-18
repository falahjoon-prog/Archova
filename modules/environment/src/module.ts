import { defineModule, type KernelServices } from '@archova/kernel';
import { createCarbonService } from './application/carbon';
import { createWasteService } from './application/waste';
import { createConditionService } from './application/conditions';
import { createMonitoringService } from './application/monitoring';
import { createRegisterService } from './application/register';
import type { EnvironmentDeps } from './application/shared';
import { environmentRoutes } from './api/routes';
import { ENVIRONMENT_PERMISSIONS } from './permissions';

export type { EnvironmentDeps } from './application/shared';

export function createEnvironmentModule(services: KernelServices, deps: EnvironmentDeps) {
  const conditions = createConditionService(deps);
  const monitoring = createMonitoringService(deps, conditions);
  const waste = createWasteService(deps);
  const carbon = createCarbonService(deps);
  const register = createRegisterService(deps, conditions, monitoring, waste, carbon);
  return {
    definition: defineModule({ name: 'environment', permissions: ENVIRONMENT_PERMISSIONS }),
    routes: environmentRoutes(services.database, conditions, register, monitoring, waste, carbon),
    api: {
      /** One project's sustainability counts for the company portfolio (`reporting`). */
      portfolioSummary: register.portfolioSummary,
    },
  };
}

export type EnvironmentModule = ReturnType<typeof createEnvironmentModule>;
