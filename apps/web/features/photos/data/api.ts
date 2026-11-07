import { unwrap } from '@archova/api-client';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { uploadFile } from '@/shared/lib/uploads';
import type { PhotoCategory, PhotoRefKind } from '../lib/types';

export interface BrowseFilters {
  album?: string;
  q?: string;
}

export async function fetchAlbums(orgId: string, projectId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/photo-albums', {
      params: { path: { orgId, projectId } },
    }),
  );
}

export async function browsePhotos(
  orgId: string,
  projectId: string,
  filters: BrowseFilters,
  cursor: string | undefined,
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/photos/browse', {
      params: {
        path: { orgId, projectId },
        query: {
          limit: 48,
          ...(filters.album ? { album: filters.album } : {}),
          ...(filters.q ? { q: filters.q } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  );
}

export async function filePhoto(
  orgId: string,
  projectId: string,
  fileId: string,
  filing: {
    category: PhotoCategory;
    refKind?: PhotoRefKind | null;
    refId?: string | null;
    fromSuggestion?: boolean;
  },
) {
  await ensureCsrfToken();
  return unwrap(
    await api.PUT('/v1/orgs/{orgId}/projects/{projectId}/photos/{fileId}/filing', {
      params: { path: { orgId, projectId, fileId } },
      body: filing,
    }),
  );
}

export async function createAlbum(orgId: string, projectId: string, name: string) {
  await ensureCsrfToken();
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/photo-albums', {
      params: { path: { orgId, projectId } },
      body: { name },
    }),
  );
}

export async function deleteAlbum(orgId: string, projectId: string, albumId: string) {
  await ensureCsrfToken();
  unwrap(
    await api.DELETE('/v1/orgs/{orgId}/projects/{projectId}/photo-albums/{albumId}', {
      params: { path: { orgId, projectId, albumId } },
    }),
  );
}

export async function addToAlbum(
  orgId: string,
  projectId: string,
  albumId: string,
  fileId: string,
) {
  await ensureCsrfToken();
  unwrap(
    await api.PUT('/v1/orgs/{orgId}/projects/{projectId}/photo-albums/{albumId}/photos/{fileId}', {
      params: { path: { orgId, projectId, albumId, fileId } },
    }),
  );
}

/** Uploads a photo straight into the project; it lands in Unclassified until it is filed or attached to a record. */
export async function uploadSitePhoto(orgId: string, projectId: string, file: File) {
  return uploadFile(orgId, { file, projectId, module: 'photos' });
}
