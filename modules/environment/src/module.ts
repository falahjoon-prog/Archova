import { defineModule, type KernelServices } from '@archova/kernel';
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
  const register = createRegisterService(deps, conditions, monitoring);
  return {
    definition: defineModule({ name: 'environment', permissions: ENVIRONMENT_PERMISSIONS }),
    routes: environmentRoutes(services.database, conditions, register, monitoring),
    api: {},
  };
}

export type EnvironmentModule = ReturnType<typeof createEnvironmentModule>;
