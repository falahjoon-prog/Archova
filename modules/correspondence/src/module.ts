import { defineModule, type KernelServices } from '@archova/kernel';
import { createCorrespondenceService, type CorrespondenceDeps } from './application/correspondence';
import { correspondenceRoutes } from './api/routes';
import { CORRESPONDENCE_PERMISSIONS } from './permissions';

export function createCorrespondenceModule(services: KernelServices, deps: CorrespondenceDeps) {
  const service = createCorrespondenceService(deps);
  return {
    definition: defineModule({ name: 'correspondence', permissions: CORRESPONDENCE_PERMISSIONS }),
    routes: correspondenceRoutes(services.database, service),
    api: {
      /** Global search (`search`): correspondence the caller can see that matches some words. */
      searchHits: service.searchHits,
      /** Related items (`links`): correspondence the caller can see among some ids. */
      linkSummaries: service.linkSummaries,
    },
  };
}

export type CorrespondenceModule = ReturnType<typeof createCorrespondenceModule>;
