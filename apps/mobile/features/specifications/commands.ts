// Specifications on the phone: spec books, their sections, and search across sections. Opening a section opens the
// book's file at the section's first page. Online only.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface SpecTarget {
  orgId: string;
  projectId: string;
}

const path = (t: SpecTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listSpecBooks(api: ApiClient, t: SpecTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/spec-books', {
      params: { path: path(t) },
    }),
  ).data;
}

export async function getSpecBook(api: ApiClient, t: SpecTarget, bookId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/spec-books/{bookId}', {
      params: { path: { ...path(t), bookId } },
    }),
  );
}

export async function searchSpecSections(api: ApiClient, t: SpecTarget, q: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/spec-sections', {
      params: { path: path(t), query: { q: q.trim(), limit: 30 } },
    }),
  ).data;
}
