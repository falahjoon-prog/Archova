'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createNotificationsApi } from '../data/api';

const key = (orgId: string) => ['orgs', orgId, 'notifications'] as const;
/** The bell checks every minute; the inbox is a courtesy, not a live feed. */
const POLL_MS = 60_000;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createNotificationsApi(orgId), [orgId]);
}

export function useInbox() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: key(orgId),
    queryFn: () => source.list(),
    refetchInterval: POLL_MS,
  });
}

export function useMarkRead() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => source.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}

export function useMarkAllRead() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}
