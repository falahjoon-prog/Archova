import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type SpecBook = components['schemas']['SpecBook'];
export type SpecSection = components['schemas']['SpecSection'];
export type SpecBookDetail = components['schemas']['SpecBookDetail'];
export type SpecSectionInput =
  components['schemas']['ReplaceSpecSectionsRequest']['sections'][number];

const P = '/v1/orgs/{orgId}/projects/{projectId}/spec-books' as const;
const B = '/v1/orgs/{orgId}/projects/{projectId}/spec-books/{bookId}' as const;
const S = '/v1/orgs/{orgId}/projects/{projectId}/spec-books/{bookId}/sections' as const;

/** Live API only: spec books have no preview store. */
export function createSpecificationsApi(orgId: string) {
  return {
    async listBooks(projectId: string): Promise<SpecBook[]> {
      return unwrap(await api.GET(P, { params: { path: { orgId, projectId } } })).data;
    },
    async getBook(projectId: string, bookId: string): Promise<SpecBookDetail> {
      return unwrap(await api.GET(B, { params: { path: { orgId, projectId, bookId } } }));
    },
    async createBook(
      projectId: string,
      input: { name: string; issuedDate?: string; supersedesBookId?: string },
    ): Promise<SpecBookDetail> {
      return unwrap(
        await api.POST(P, {
          params: { path: { orgId, projectId } },
          body: {
            name: input.name,
            ...(input.issuedDate ? { issuedDate: input.issuedDate } : {}),
            ...(input.supersedesBookId ? { supersedesBookId: input.supersedesBookId } : {}),
          },
        }),
      );
    },
    /** `version` is the book's version as last read; a stale one is refused. */
    async replaceSections(
      projectId: string,
      bookId: string,
      version: number,
      sections: SpecSectionInput[],
    ): Promise<SpecBookDetail> {
      return unwrap(
        await api.PUT(S, {
          params: { path: { orgId, projectId, bookId }, header: { 'If-Match': `"${version}"` } },
          body: { sections },
        }),
      );
    },
  };
}
