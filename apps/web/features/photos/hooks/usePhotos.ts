'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import * as api from '../data/api';
import type { PhotoCategory, PhotoRefKind } from '../lib/types';

// The signed links last 5 minutes; refetch before they lapse.
const STALE = 3 * 60_000;

export function usePhotoAlbums() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'photos', { view: 'albums' }),
    queryFn: () => api.fetchAlbums(orgId, projectId),
    staleTime: STALE,
  });
}

export function usePhotoFeed(filters: api.BrowseFilters) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useInfiniteQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'photos', { view: 'feed', ...filters }),
    queryFn: ({ pageParam }) => api.browsePhotos(orgId, projectId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
    staleTime: STALE,
  });
}

export function usePhotoMutations() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'photos') });
  return {
    upload: useMutation({
      mutationFn: (file: File) => api.uploadSitePhoto(orgId, projectId, file),
      onSuccess: refresh,
    }),
    file: useMutation({
      mutationFn: (v: {
        fileId: string;
        category: PhotoCategory;
        refKind?: PhotoRefKind | null;
        refId?: string | null;
        fromSuggestion?: boolean;
      }) => {
        const { fileId, ...filing } = v;
        return api.filePhoto(orgId, projectId, fileId, filing);
      },
      onSuccess: refresh,
    }),
    createAlbum: useMutation({
      mutationFn: (name: string) => api.createAlbum(orgId, projectId, name),
      onSuccess: refresh,
    }),
    deleteAlbum: useMutation({
      mutationFn: (albumId: string) => api.deleteAlbum(orgId, projectId, albumId),
      onSuccess: refresh,
    }),
    addToAlbum: useMutation({
      mutationFn: (v: { albumId: string; fileId: string }) =>
        api.addToAlbum(orgId, projectId, v.albumId, v.fileId),
      onSuccess: refresh,
    }),
  };
}
