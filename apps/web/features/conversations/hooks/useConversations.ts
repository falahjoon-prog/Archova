'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { ApiError } from '@archova/api-client';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createConversationsApi } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createConversationsApi(orgId), [orgId]);
}

/** Outside users (subcontractors, owners) are refused by the API; the card then simply does not show. */
export const isForbidden = (error: unknown) => error instanceof ApiError && error.status === 403;

export function useConversations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'conversations', {}),
    queryFn: () => source.list(projectId),
    retry: (count, error) => !isForbidden(error) && count < 2,
  });
}

/** The full list for the "See all" page, a page at a time. */
export function useAllConversations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useInfiniteQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'conversations', { all: true }),
    queryFn: ({ pageParam }) => source.list(projectId, 25, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: (count, error) => !isForbidden(error) && count < 2,
  });
}

export function useConversation(projectId: string, conversationId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'conversations', { id: conversationId }),
    queryFn: () => source.get(projectId, conversationId!),
    enabled: conversationId !== null,
  });
}

/** Starting or answering changes what everyone sees, so it waits for the server and refreshes the list. */
function useRefresh(projectId: string) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'conversations') });
}

export function useStartConversation(projectId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: { subject: string; body: string; mentions?: string[] }) =>
      source.create(projectId, v),
    onSuccess: refresh,
  });
}

export function usePostMessage(projectId: string, conversationId: string) {
  const source = useApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: { body: string; mentions?: string[] }) =>
      source.post(projectId, conversationId, v),
    onSuccess: refresh,
  });
}
