import { defineModule, type KernelServices } from '@archova/kernel';
import { createConditionService } from './application/conditions';
import { createRegisterService } from './application/register';
import type { EnvironmentDeps } from './application/shared';
import { environmentRoutes } from './api/routes';
import { ENVIRONMENT_PERMISSIONS } from './permissions';

export type { EnvironmentDeps } from './application/shared';

export function createEnvironmentModule(services: KernelServices, deps: EnvironmentDeps) {
  const conditions = createConditionService(deps);
  const register = createRegisterService(deps, conditions);
  return {
    definition: defineModule({ name: 'environment', permissions: ENVIRONMENT_PERMISSIONS }),
    routes: environmentRoutes(services.database, conditions, register),
    api: {},
  };
}

export type EnvironmentModule = ReturnType<typeof createEnvironmentModule>;
