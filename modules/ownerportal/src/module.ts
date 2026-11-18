import { defineModule, type KernelServices } from '@archova/kernel';
import { createOwnerPortalService, type OwnerPortalDeps } from './application/ownerportal';
import { createShareService, type ShareDeps } from './application/share';
import { ownerPortalRoutes } from './api/routes';
import { OWNERPORTAL_PERMISSIONS } from './permissions';

export type OwnerPortalShareConfig = Pick<
  ShareDeps,
  'files' | 'approvedChanges' | 'entitlements' | 'messages' | 'baseUrl' | 'senderName'
>;

export function createOwnerPortalModule(
  services: KernelServices,
  deps: OwnerPortalDeps & { share: OwnerPortalShareConfig },
) {
  const service = createOwnerPortalService(deps);
  const share = createShareService({
    ...deps.share,
    database: services.database,
    access: deps.access,
    platform: deps.platform,
    redis: services.redis,
    logger: services.logger,
    now: deps.now,
  });
  return {
    definition: defineModule({ name: 'ownerportal', permissions: OWNERPORTAL_PERMISSIONS }),
    routes: ownerPortalRoutes(services.database, service, share),
  };
}

export type OwnerPortalModule = ReturnType<typeof createOwnerPortalModule>;
