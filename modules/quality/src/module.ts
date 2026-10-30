import { defineModule, type KernelServices } from '@archova/kernel';
import { createInspectionService } from './application/inspections';
import { createObservationService } from './application/observations';
import type { QualityDeps } from './application/shared';
import { qualityRoutes } from './api/routes';
import { QUALITY_PERMISSIONS } from './permissions';

export type { QualityDeps } from './application/shared';

export function createQualityModule(services: KernelServices, deps: QualityDeps) {
  const inspections = createInspectionService(deps);
  const observations = createObservationService(deps);
  return {
    definition: defineModule({ name: 'quality', permissions: QUALITY_PERMISSIONS }),
    routes: qualityRoutes(services.database, inspections, observations),
    api: {},
  };
}

export type QualityModule = ReturnType<typeof createQualityModule>;
