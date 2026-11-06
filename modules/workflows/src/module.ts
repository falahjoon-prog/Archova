import { uuidv7 } from '@archova/domain';
import { defineModule, type KernelServices } from '@archova/kernel';
import { workflowsRoutes } from './api/routes';
import { createWorkflowsService } from './application/workflows';
import { WORKFLOWS_PERMISSIONS } from './permissions';

/**
 * Workflows: approval chains an organisation configures per kind of record. The owning module (first: financials, for
 * variations) calls `start` when a record is submitted, `decide` on each approval and `cancel` when it is withdrawn;
 * with no active chain, `start` and `decide` return null and the module's own approval stays in force.
 */
export function createWorkflowsModule(services: KernelServices, opts: { now?: () => Date } = {}) {
  const service = createWorkflowsService({ newId: uuidv7, ...(opts.now ? { now: opts.now } : {}) });
  return {
    definition: defineModule({ name: 'workflows', permissions: WORKFLOWS_PERMISSIONS }),
    routes: workflowsRoutes(services.database, service),
    api: {
      start: service.start,
      decide: service.decide,
      cancel: service.cancel,
      forSubject: service.forSubject,
    },
  };
}

export type WorkflowsModule = ReturnType<typeof createWorkflowsModule>;
