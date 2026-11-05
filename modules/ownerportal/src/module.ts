import { defineModule, type KernelServices } from '@archova/kernel';
import { createOwnerPortalService, type OwnerPortalDeps } from './application/ownerportal';
import { ownerPortalRoutes } from './api/routes';
import { OWNERPORTAL_PERMISSIONS } from './permissions';

export function createOwnerPortalModule(services: KernelServices, deps: OwnerPortalDeps) {
  const service = createOwnerPortalService(deps);
  return {
    definition: defineModule({ name: 'ownerportal', permissions: OWNERPORTAL_PERMISSIONS }),
    routes: ownerPortalRoutes(services.database, service),
  };
}

export type OwnerPortalModule = ReturnType<typeof createOwnerPortalModule>;
