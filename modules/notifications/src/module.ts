import { defineModule, type KernelServices } from '@archova/kernel';
import { notificationsRoutes } from './api/routes';
import { createNotificationService } from './application/notifications';

/** The in-app inbox. Other modules (and worker jobs) add to it with `createNotifications`; people read it here. */
export function createNotificationsModule(services: KernelServices) {
  const service = createNotificationService();
  return {
    definition: defineModule({ name: 'notifications', permissions: [] }),
    routes: notificationsRoutes(services.database, service),
  };
}

export type NotificationsModule = ReturnType<typeof createNotificationsModule>;
