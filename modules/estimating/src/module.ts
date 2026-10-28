import { defineModule, type KernelServices } from '@archova/kernel';
import { createTenderService, type EstimatingDeps } from './application/tender';
import { estimatingRoutes } from './api/routes';
import { ESTIMATING_PERMISSIONS } from './permissions';

export function createEstimatingModule(services: KernelServices, deps: EstimatingDeps) {
  const tenders = createTenderService(deps);
  return {
    definition: defineModule({ name: 'estimating', permissions: ESTIMATING_PERMISSIONS }),
    routes: estimatingRoutes(services.database, tenders),
    api: {},
  };
}

export type EstimatingModule = ReturnType<typeof createEstimatingModule>;
export type EstimatingApi = EstimatingModule['api'];
