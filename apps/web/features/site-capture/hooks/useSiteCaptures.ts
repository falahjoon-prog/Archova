'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createSiteCaptureApi, type NewSiteCapture } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createSiteCaptureApi(orgId), [orgId]);
}

// Captures live with the coordination tool, so they share its key space and refresh with it.
export function useSiteCaptures() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'coordination', { captures: true }),
    queryFn: () => api.list(projectId),
  });
}

export function useRfiOptions(enabled: boolean) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'rfis', { options: true }),
    queryFn: () => api.listRfis(projectId),
    enabled,
  });
}

export function useCaptureObservations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'coordination', { captureObservations: true }),
    queryFn: () => api.observations(projectId, 'open'),
  });
}

export function useSiteCaptureMutations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'coordination') });
  return {
    add: useMutation({
      mutationFn: (body: NewSiteCapture) => api.create(projectId, body),
      onSuccess: refresh,
    }),
    link: useMutation({
      mutationFn: (v: {
        id: string;
        version: number;
        rfiId: string | null;
        issueId?: string | null;
      }) =>
        api.update(projectId, v.id, v.version, {
          rfiId: v.rfiId,
          ...(v.issueId !== undefined ? { issueId: v.issueId } : {}),
        }),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.remove(projectId, id),
      onSuccess: refresh,
    }),
    scan: useMutation({
      mutationFn: (v: { still: File; note: string }) => api.scanStill(projectId, v),
      onSuccess: refresh,
    }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'confirmed' | 'dismissed'; note?: string }) =>
        api.review(projectId, v.id, v.decision, v.note),
      onSuccess: refresh,
    }),
    raise: useMutation({
      mutationFn: (v: { title: string; description: string; location: string }) =>
        api.raiseIssue(projectId, v),
    }),
  };
}
