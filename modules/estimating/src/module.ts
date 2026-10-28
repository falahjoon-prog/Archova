import { defineModule, type KernelServices } from '@archova/kernel';
import { createTakeoffService } from './application/takeoff';
import { createTenderService, type EstimatingDeps } from './application/tender';
import { estimatingRoutes } from './api/routes';
import { ESTIMATING_PERMISSIONS } from './permissions';

export function createEstimatingModule(services: KernelServices, deps: EstimatingDeps) {
  const tenders = createTenderService(deps);
  const takeoff = createTakeoffService(deps);
  return {
    definition: defineModule({ name: 'estimating', permissions: ESTIMATING_PERMISSIONS }),
    routes: estimatingRoutes(services.database, tenders, takeoff),
    api: { scopeForQuoteReading: tenders.scopeForQuoteReading },
  };
}

export type EstimatingModule = ReturnType<typeof createEstimatingModule>;
export type EstimatingApi = EstimatingModule['api'];
