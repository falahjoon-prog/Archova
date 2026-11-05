import { defineModule, type KernelServices } from '@archova/kernel';
import { createBimService, type BimDeps } from './application/bim';
import { bimRoutes } from './api/routes';
import { BIM_PERMISSIONS } from './permissions';

export function createBimModule(services: KernelServices, deps: BimDeps) {
  const service = createBimService(deps);
  return {
    definition: defineModule({ name: 'bim', permissions: BIM_PERMISSIONS }),
    routes: bimRoutes(services.database, service),
  };
}

export type BimModule = ReturnType<typeof createBimModule>;
