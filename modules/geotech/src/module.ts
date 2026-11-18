import { defineModule, type KernelServices } from '@archova/kernel';
import { createGeotechService, type GeotechDeps } from './application/geotech';
import { geotechRoutes } from './api/routes';
import { GEOTECH_PERMISSIONS } from './permissions';

export type { GeotechDeps } from './application/geotech';

export function createGeotechModule(services: KernelServices, deps: GeotechDeps) {
  const geotech = createGeotechService(deps);
  return {
    definition: defineModule({ name: 'geotech', permissions: GEOTECH_PERMISSIONS }),
    routes: geotechRoutes(services.database, geotech),
    api: {
      /** For Nova (`/ai/assist`): rule-based attention flags for a project. */
      flags: geotech.flags,
    },
  };
}

export type GeotechModule = ReturnType<typeof createGeotechModule>;
export type GeotechApi = GeotechModule['api'];
