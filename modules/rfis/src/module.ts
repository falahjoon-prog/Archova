import { defineModule, type KernelServices } from '@archova/kernel';
import { createRfiService, type RfisDeps } from './application/rfis';
import { rfisRoutes } from './api/routes';
import { RFIS_PERMISSIONS } from './permissions';

export function createRfisModule(services: KernelServices, deps: RfisDeps) {
  const service = createRfiService(deps);
  return {
    definition: defineModule({ name: 'rfis', permissions: RFIS_PERMISSIONS }),
    routes: rfisRoutes(services.database, service),
    api: {
      /** X49 import command; called by the integrations import job only. */
      importRfi: service.importRfi,
    },
  };
}

export type RfisModule = ReturnType<typeof createRfisModule>;
export type RfisApi = RfisModule['api'];
