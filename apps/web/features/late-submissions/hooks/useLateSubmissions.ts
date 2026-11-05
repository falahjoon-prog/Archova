'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createLateSubmissionsApi, type LateStatus } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createLateSubmissionsApi(orgId), [orgId]);
}

export function useLateSubmissions(status: LateStatus) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'late-submissions', { status }),
    queryFn: () => api.list(projectId, status),
  });
}

/** A refused accept leaves the change waiting, so the list is refreshed either way. */
export function useLateSubmissionMutations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'late-submissions') });
  return {
    accept: useMutation({
      mutationFn: (id: string) => api.accept(projectId, id),
      onSettled: refresh,
    }),
    reject: useMutation({
      mutationFn: (v: { id: string; note?: string }) => api.reject(projectId, v.id, v.note),
      onSettled: refresh,
    }),
  };
}
