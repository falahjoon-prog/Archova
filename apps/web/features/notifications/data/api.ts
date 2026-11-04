// The in-app inbox against the notifications endpoints (product/07 MTG-AC3).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type Notification = S['Notification'];
export type NotificationList = S['NotificationList'];

export function createNotificationsApi(orgId: string) {
  const path = { orgId };
  return {
    async list(unreadOnly = false): Promise<NotificationList> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/notifications', {
          params: { path, query: { unreadOnly, limit: 50 } },
        }),
      );
    },
    async markRead(id: string): Promise<Notification> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/notifications/{notificationId}/read', {
          params: { path: { ...path, notificationId: id } },
        }),
      );
    },
    async markAllRead(): Promise<void> {
      await ensureCsrfToken();
      unwrap(await api.POST('/v1/orgs/{orgId}/notifications/read-all', { params: { path } }));
    },
  };
}
