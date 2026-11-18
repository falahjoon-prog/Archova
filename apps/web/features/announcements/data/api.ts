// Project announcements against the announcements module's endpoints (and Nova's draft task).

import { unwrap } from '@archova/api-client';
import type {
  AnnouncementDetail,
  AnnouncementDraft,
  AnnouncementNudgeResult,
  AnnouncementPage,
  CreateAnnouncementRequest,
} from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

export type {
  AnnouncementDetail,
  AnnouncementDraft,
  AnnouncementNudgeResult,
  AnnouncementPage,
  CreateAnnouncementRequest,
};
export type AnnouncementSummary = AnnouncementPage['data'][number];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createAnnouncementsApi(orgId: string) {
  const path = (projectId: string) => ({ path: { orgId, projectId } });
  const item = (projectId: string, announcementId: string) => ({
    path: { orgId, projectId, announcementId },
  });
  return {
    list: async (
      projectId: string,
      opts: { limit?: number; cursor?: string; unread?: boolean } = {},
    ): Promise<AnnouncementPage> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/announcements', {
          params: {
            ...path(projectId),
            query: {
              limit: opts.limit ?? 5,
              ...(opts.cursor ? { cursor: opts.cursor } : {}),
              ...(opts.unread ? { unread: 'true' as const } : {}),
            },
          },
        }),
      ),
    get: async (projectId: string, announcementId: string): Promise<AnnouncementDetail> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/announcements/{announcementId}', {
          params: item(projectId, announcementId),
        }),
      ),
    create: async (
      projectId: string,
      body: CreateAnnouncementRequest,
    ): Promise<AnnouncementDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/announcements', {
          params: { ...path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    markRead: async (projectId: string, announcementId: string): Promise<AnnouncementDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/announcements/{announcementId}/read',
          { params: { ...item(projectId, announcementId), header: idempotencyKey() } },
        ),
      );
    },
    nudge: async (
      projectId: string,
      announcementId: string,
      userIds: string[],
    ): Promise<AnnouncementNudgeResult> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/announcements/{announcementId}/nudges',
          {
            params: { ...item(projectId, announcementId), header: idempotencyKey() },
            body: { userIds },
          },
        ),
      );
    },
    draft: async (
      projectId: string,
      body: { notes: string; audience?: string },
    ): Promise<AnnouncementDraft> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/ai/announcement-drafts', {
          params: path(projectId),
          body,
        }),
      );
    },
  };
}
