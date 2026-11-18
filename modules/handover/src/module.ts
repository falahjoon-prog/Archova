import { defineModule, type KernelServices } from '@archova/kernel';
import { createHandoverService, type HandoverDeps } from './application/handover';
import { handoverRoutes } from './api/routes';
import { HANDOVER_PERMISSIONS } from './permissions';

export type { HandoverDeps } from './application/handover';

export function createHandoverModule(services: KernelServices, deps: HandoverDeps) {
  const handover = createHandoverService(deps);
  return {
    definition: defineModule({ name: 'handover', permissions: HANDOVER_PERMISSIONS }),
    routes: handoverRoutes(services.database, handover),
    api: {
      /** For Nova (`/ai/assist`): rule-based attention flags for a project's close-out. */
      flags: handover.flags,
    },
  };
}

export type HandoverModule = ReturnType<typeof createHandoverModule>;
export type HandoverApi = HandoverModule['api'];
