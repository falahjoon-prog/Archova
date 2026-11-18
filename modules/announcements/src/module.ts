import { defineModule, type KernelServices } from '@archova/kernel';
import { createAnnouncementsService, type AnnouncementsDeps } from './application/announcements';
import { announcementsRoutes } from './api/routes';
import { ANNOUNCEMENTS_PERMISSIONS } from './permissions';

export function createAnnouncementsModule(services: KernelServices, deps: AnnouncementsDeps) {
  const service = createAnnouncementsService(deps);
  return {
    definition: defineModule({ name: 'announcements', permissions: ANNOUNCEMENTS_PERMISSIONS }),
    routes: announcementsRoutes(services.database, service, deps.now),
    api: {},
  };
}

export type AnnouncementsModule = ReturnType<typeof createAnnouncementsModule>;
