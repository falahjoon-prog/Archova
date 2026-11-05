import { defineModule, type KernelServices } from '@archova/kernel';
import { createBoardService } from './application/board';
import { createEstimateService } from './application/estimate';
import { createLibraryService } from './application/library';
import { createTakeoffService } from './application/takeoff';
import { createTenderService, type EstimatingDeps } from './application/tender';
import { estimatingRoutes } from './api/routes';
import { ESTIMATING_PERMISSIONS } from './permissions';

export function createEstimatingModule(services: KernelServices, deps: EstimatingDeps) {
  const tenders = createTenderService(deps);
  const takeoff = createTakeoffService(deps);
  const library = createLibraryService(deps);
  const estimates = createEstimateService({ ...deps, library });
  const board = createBoardService(deps);
  return {
    definition: defineModule({ name: 'estimating', permissions: ESTIMATING_PERMISSIONS }),
    routes: estimatingRoutes(services.database, tenders, takeoff, library, estimates, board),
    api: {
      scopeForQuoteReading: tenders.scopeForQuoteReading,
      quoteForNegotiation: tenders.quoteForNegotiation,
    },
  };
}

export type EstimatingModule = ReturnType<typeof createEstimatingModule>;
export type EstimatingApi = EstimatingModule['api'];
