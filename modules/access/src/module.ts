import {
  FOUNDATION_PERMISSIONS,
  buildRegistry,
  type PermissionDefinition,
} from '@archova/domain/permissions';
import { defineModule, type KernelServices } from '@archova/kernel';
import { createAccessService, type ProjectMembershipLookup } from './application/access-service';
import { accessRoutes } from './api/routes';

export function createAccessModule(
  services: KernelServices,
  opts: {
    lookupProjectMember: ProjectMembershipLookup;
    extraPermissions?: ReadonlyArray<readonly PermissionDefinition[]>;
  },
) {
  const registry = buildRegistry(FOUNDATION_PERMISSIONS, ...(opts.extraPermissions ?? []));
  const service = createAccessService({ registry, lookupProjectMember: opts.lookupProjectMember });
  return {
    definition: defineModule({ name: 'access' }),
    routes: accessRoutes(services.database, service),
    api: service,
    registry,
  };
}

export type AccessModule = ReturnType<typeof createAccessModule>;
