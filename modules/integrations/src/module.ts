import { defineModule, type KernelServices } from '@archova/kernel';
import { createImportService, type ImportsDeps } from './application/imports';
import { integrationsRoutes } from './api/routes';
import { INTEGRATIONS_PERMISSIONS } from './permissions';

export function createIntegrationsModule(services: KernelServices, deps: ImportsDeps) {
  const imports = createImportService(deps);
  return {
    definition: defineModule({ name: 'integrations', permissions: INTEGRATIONS_PERMISSIONS }),
    routes: integrationsRoutes(services.database, imports),
    api: {},
  };
}

export type IntegrationsModule = ReturnType<typeof createIntegrationsModule>;
