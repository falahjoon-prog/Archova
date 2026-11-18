// Documents on the phone: browse folders, search, read a document's revisions and open the file. Online only; the API
// already hides folders the caller may not open, so the phone never filters by permission itself.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface DocumentTarget {
  orgId: string;
  projectId: string;
}

const path = (t: DocumentTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listFolders(api: ApiClient, t: DocumentTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/folders', { params: { path: path(t) } }),
  ).data;
}

export async function listDocuments(
  api: ApiClient,
  t: DocumentTarget,
  filter: { folderId?: string; q?: string } = {},
) {
  const query: { folderId?: string; q?: string; limit?: number } = { limit: 50 };
  if (filter.folderId) query.folderId = filter.folderId;
  if (filter.q?.trim()) query.q = filter.q.trim();
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents', {
      params: { path: path(t), query },
    }),
  ).data;
}

export async function getDocument(api: ApiClient, t: DocumentTarget, documentId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents/{documentId}', {
      params: { path: { ...path(t), documentId } },
    }),
  );
}
