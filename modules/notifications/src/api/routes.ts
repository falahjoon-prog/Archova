import { defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { NotificationService } from '../application/notifications';

export function notificationsRoutes(database: Database, service: NotificationService) {
  return defineRoutes({
    listNotifications: async (input) => ({
      status: 200,
      body: await database.withTenantTx(
        requireTenant(input),
        (s) =>
          service.list(s, {
            unreadOnly: input.query.unreadOnly ?? false,
            limit: input.query.limit ?? 30,
          }),
        { readOnly: true },
      ),
    }),
    markNotificationRead: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireTenant(input), (s) =>
        service.markRead(s, input.params.notificationId),
      ),
    }),
    markAllNotificationsRead: async (input) => {
      await database.withTenantTx(requireTenant(input), (s) => service.markAllRead(s));
      return { status: 204 };
    },
  });
}
