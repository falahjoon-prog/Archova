import { defineModule, type KernelServices } from '@archova/kernel';
import { createPermitService, type PermitsDeps } from './application/permits';
import { permitsRoutes } from './api/routes';
import { PERMITS_PERMISSIONS } from './permissions';

export type { PermitsDeps } from './application/permits';

export function createPermitsModule(services: KernelServices, deps: PermitsDeps) {
  const permits = createPermitService(deps);
  return {
    definition: defineModule({ name: 'permits', permissions: PERMITS_PERMISSIONS }),
    routes: permitsRoutes(services.database, permits),
    api: {
      /** For the site compliance gate: open permits on a project and their status today. */
      statusSummary: permits.statusSummary,
      /** For Nova (`/ai/assist`): rule-based attention flags for a project. */
      flags: permits.flags,
    },
  };
}

export type PermitsModule = ReturnType<typeof createPermitsModule>;
export type PermitsApi = PermitsModule['api'];
