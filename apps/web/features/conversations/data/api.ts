// Project conversations against the conversations module's endpoints.

import { unwrap } from '@archova/api-client';
import type { ConversationDetail, ConversationPage } from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

export type { ConversationDetail, ConversationPage };
export type ConversationSummary = ConversationPage['data'][number];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createConversationsApi(orgId: string) {
  return {
    list: async (projectId: string, limit = 5): Promise<ConversationPage> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/conversations', {
          params: { path: { orgId, projectId }, query: { limit } },
        }),
      ),
    get: async (projectId: string, conversationId: string): Promise<ConversationDetail> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/conversations/{conversationId}', {
          params: { path: { orgId, projectId, conversationId } },
        }),
      ),
    create: async (
      projectId: string,
      body: { subject: string; body: string },
    ): Promise<ConversationDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/conversations', {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    post: async (
      projectId: string,
      conversationId: string,
      body: string,
    ): Promise<ConversationDetail> => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(
          '/v1/orgs/{orgId}/projects/{projectId}/conversations/{conversationId}/messages',
          {
            params: { path: { orgId, projectId, conversationId }, header: idempotencyKey() },
            body: { body },
          },
        ),
      );
    },
  };
}
