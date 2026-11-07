// A person's own bookmarks against the bookmarks endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type Bookmark = S['Bookmark'];
export type BookmarkInput = S['BookmarkInput'];
export type BookmarkEntityType = S['BookmarkEntityType'];

export function createBookmarksApi(orgId: string) {
  const path = { orgId };
  return {
    async list(projectId?: string): Promise<Bookmark[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/bookmarks', {
          params: { path, query: projectId ? { projectId } : {} },
        }),
      ).data;
    },
    async save(input: BookmarkInput): Promise<Bookmark> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/bookmarks', { params: { path }, body: input }),
      );
    },
    async remove(bookmarkId: string): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/bookmarks/{bookmarkId}', {
          params: { path: { ...path, bookmarkId } },
        }),
      );
    },
  };
}
