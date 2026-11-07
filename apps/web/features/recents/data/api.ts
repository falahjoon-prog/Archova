// A person's own recently opened records against the recents endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type RecentView = S['RecentView'];
export type RecentViewInput = S['RecentViewInput'];
export type RecentViewEntityType = S['RecentViewEntityType'];

export function createRecentsApi(orgId: string) {
  const path = { orgId };
  return {
    async list(projectId: string, limit: number): Promise<RecentView[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/recents', {
          params: { path, query: { projectId, limit } },
        }),
      ).data;
    },
    async record(input: RecentViewInput): Promise<void> {
      await ensureCsrfToken();
      unwrap(await api.POST('/v1/orgs/{orgId}/recents', { params: { path }, body: input }));
    },
  };
}
