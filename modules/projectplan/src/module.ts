import { defineModule, type KernelServices } from '@archova/kernel';
import { projectPlanRoutes } from './api/routes';
import { createProjectPlanService, type ProjectPlanDeps } from './application/plan';
import { PROJECTPLAN_PERMISSIONS } from './permissions';

/**
 * The project's action plan: a phased, numbered checklist across the project's life, where each item links to the
 * RFI, inspection, meeting or signed document that does the work, and a hold point stops later items completing.
 */
export function createProjectPlanModule(services: KernelServices, deps: ProjectPlanDeps) {
  const service = createProjectPlanService(deps);
  return {
    definition: defineModule({ name: 'projectplan', permissions: PROJECTPLAN_PERMISSIONS }),
    routes: projectPlanRoutes(services.database, service),
    api: {},
  };
}

export type ProjectPlanModule = ReturnType<typeof createProjectPlanModule>;
