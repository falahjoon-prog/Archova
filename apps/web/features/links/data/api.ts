// Related items against the links module's endpoints.

import { unwrap } from '@archova/api-client';
import type { LinkEntityType, LinkReason } from '@archova/domain';
import type { RelatedItemCandidateList, RelatedItemList } from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

export type { LinkEntityType, LinkReason, RelatedItemCandidateList, RelatedItemList };
export type RelatedItem = RelatedItemList['data'][number];
export type RelatedItemSummary = RelatedItem['item'];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createLinksApi(orgId: string) {
  return {
    list: async (projectId: string, type: LinkEntityType, id: string): Promise<RelatedItemList> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/related-items', {
          params: { path: { orgId, projectId }, query: { type, id } },
        }),
      ),
    candidates: async (
      projectId: string,
      type: LinkEntityType,
      q: string,
    ): Promise<RelatedItemCandidateList> =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/related-items/candidates', {
          params: { path: { orgId, projectId }, query: { type, q, limit: 8 } },
        }),
      ),
    create: async (
      projectId: string,
      body: {
        from: { type: LinkEntityType; id: string };
        to: { type: LinkEntityType; id: string };
        reason: LinkReason;
        note?: string | null;
      },
    ) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/related-items', {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    remove: async (projectId: string, linkId: string): Promise<void> => {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/projects/{projectId}/related-items/{linkId}', {
          params: { path: { orgId, projectId, linkId } },
        }),
      );
    },
  };
}
