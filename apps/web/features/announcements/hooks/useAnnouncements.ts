'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '@archova/api-client';
import { atLeast } from '@archova/domain/permissions';
import { queryKeys } from '@archova/query';
import { useProjectPermissions } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createAnnouncementsApi, type CreateAnnouncementRequest } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createAnnouncementsApi(orgId), [orgId]);
}

/** Posting needs standard access to the directory (or an org owner/admin). The API enforces it too. */
export function useCanPostAnnouncements(projectId: string): boolean {
  const { orgId } = useCurrentOrg();
  const perms = useProjectPermissions(orgId, projectId).data;
  return (
    perms?.orgRole === 'owner' ||
    perms?.orgRole === 'admin' ||
    atLeast(perms?.toolLevels.directory, 'standard')
  );
}

export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

export function useAnnouncements(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'announcements', {}),
    queryFn: () => source.list(projectId, { limit: 4 }),
    retry: (count, error) => !isForbidden(error) && count < 2,
  });
}

export function useAllAnnouncements(projectId: string, unreadOnly: boolean) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'announcements', { all: true, unreadOnly }),
    queryFn: ({ pageParam }) =>
      source.list(projectId, { limit: 25, cursor: pageParam, unread: unreadOnly }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useAnnouncement(projectId: string, announcementId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'announcements', { id: announcementId }),
    queryFn: () => source.get(projectId, announcementId!),
    enabled: announcementId !== null,
  });
}

function useRefresh(projectId: string) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'announcements') });
}

export function usePostAnnouncement(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: CreateAnnouncementRequest) => source.create(projectId, v),
    onSuccess: refresh,
  });
}

/** Opening an announcement is what marks it read, so the list's unread dots clear straight away. */
export function useMarkRead(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (announcementId: string) => source.markRead(projectId, announcementId),
    onSuccess: refresh,
  });
}

export function useNudge(projectId: string, announcementId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (userIds: string[]) => source.nudge(projectId, announcementId, userIds),
    onSuccess: refresh,
  });
}

export function useDraftAnnouncement(projectId: string) {
  const source = useApi();
  return useMutation({
    mutationFn: (v: { notes: string; audience?: string }) => source.draft(projectId, v),
  });
}
