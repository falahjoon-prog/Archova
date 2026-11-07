import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type SearchResults = components['schemas']['SearchResults'];
export type SearchResult = components['schemas']['SearchResult'];

export function createSearchApi(orgId: string) {
  return {
    async search(q: string): Promise<SearchResults> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/search', { params: { path: { orgId }, query: { q } } }),
      );
    },
  };
}
