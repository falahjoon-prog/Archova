'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createBookmarksApi, type BookmarkInput } from '../data/api';

const key = (orgId: string) => ['orgs', orgId, 'bookmarks'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createBookmarksApi(orgId), [orgId]);
}

/** All of the person's bookmarks; every toggle on a screen shares this one query. */
export function useBookmarks(projectId?: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: projectId ? [...key(orgId), { projectId }] : key(orgId),
    queryFn: () => source.list(projectId),
  });
}

export function useSaveBookmark() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: BookmarkInput) => source.save(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}

export function useRemoveBookmark() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}
