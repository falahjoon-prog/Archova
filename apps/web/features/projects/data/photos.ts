import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ProjectPhoto = S['ProjectPhoto'];
export type PhotoTags = S['PhotoTags'];
export type PhotoFacet = S['PhotoFacet'];

export interface PhotoFilters {
  area?: string;
  trade?: string;
  tag?: string;
  sinceDays?: number;
}

export interface PhotoList {
  data: ProjectPhoto[];
  facets: { areas: PhotoFacet[]; trades: PhotoFacet[] };
}

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;

/** The newest photos on a project, from every module that takes site photos, narrowed by the filters. */
export async function fetchProjectPhotos(
  orgId: string,
  projectId: string,
  limit: number,
  filters: PhotoFilters = {},
): Promise<PhotoList> {
  return unwrap(
    await api.GET(`${P}/photos`, {
      params: { path: { orgId, projectId }, query: { limit, ...filters } },
    }),
  );
}

export interface PhotoTagInput {
  area: string | null;
  trade: string | null;
  tags: string[];
  /** Set when the person confirmed a Nova suggestion unchanged or edited. */
  novaRunId?: string;
}

export async function savePhotoTags(
  orgId: string,
  projectId: string,
  fileId: string,
  body: PhotoTagInput,
): Promise<PhotoTags | null> {
  const res = unwrap(
    await api.PUT(`${P}/photos/{fileId}/tags`, {
      params: { path: { orgId, projectId, fileId } },
      body,
    }),
  );
  return res.tags;
}

export interface PhotoTagSuggestion {
  runId: string;
  area: string | null;
  trade: string | null;
  tags: string[];
  photoUnclear: boolean;
}

export async function suggestPhotoTags(
  orgId: string,
  projectId: string,
  fileId: string,
  knownAreas: string[],
): Promise<PhotoTagSuggestion> {
  return unwrap(
    await api.POST(`${P}/ai/photos/tag-suggestions`, {
      params: { path: { orgId, projectId } },
      body: { photo: { fileId }, knownAreas },
    }),
  );
}
