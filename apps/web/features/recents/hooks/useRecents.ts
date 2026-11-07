'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createRecentsApi, type RecentViewInput } from '../data/api';

const key = (orgId: string, projectId: string) => ['orgs', orgId, 'recents', projectId] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createRecentsApi(orgId), [orgId]);
}

/** The person's latest opened records in one project, newest first. */
export function useRecents(projectId: string, limit = 8) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: [...key(orgId, projectId), limit],
    queryFn: () => source.list(projectId, limit),
  });
}

export function useRecordRecent() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecentViewInput) => source.record(input),
    onSuccess: (_d, input) =>
      qc.invalidateQueries({ queryKey: key(orgId, input.projectId).slice(0, 4) }),
  });
}
