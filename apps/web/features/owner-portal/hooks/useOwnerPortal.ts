'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createOwnerPortalApi } from '../data/api';

function useCtx() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useMemo(() => createOwnerPortalApi(orgId), [orgId]);
  return { orgId, projectId, source };
}

export function useProgressUpdates() {
  const { orgId, projectId, source } = useCtx();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'owner-portal', { part: 'updates' }),
    queryFn: () => source.updates(projectId),
  });
}
export function useApprovals() {
  const { orgId, projectId, source } = useCtx();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'owner-portal', { part: 'approvals' }),
    queryFn: () => source.approvals(projectId),
  });
}
export function useCapitalPlan() {
  const { orgId, projectId, source } = useCtx();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'owner-portal', { part: 'plan' }),
    queryFn: () => source.plan(projectId),
  });
}

export function useShareLinks() {
  const { orgId, projectId, source } = useCtx();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'owner-portal', { part: 'share-links' }),
    queryFn: () => source.shareLinks(projectId),
  });
}
// The signed photo links last 10 minutes; refetch before they lapse.
export function useSharedPhotos() {
  const { orgId, projectId, source } = useCtx();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'owner-portal', { part: 'shared-photos' }),
    queryFn: () => source.sharedPhotos(projectId),
    staleTime: 5 * 60_000,
  });
}

/** Every mutation refreshes the whole portal: the three tabs are small and share one root key. */
export function useOwnerPortalMutations() {
  const { orgId, projectId, source } = useCtx();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'owner-portal') });
  const opts = { onSettled: refresh };
  return {
    createShareLink: useMutation({
      mutationFn: (v: Parameters<typeof source.createShareLink>[1]) =>
        source.createShareLink(projectId, v),
      ...opts,
    }),
    revokeShareLink: useMutation({
      mutationFn: (id: string) => source.revokeShareLink(projectId, id),
      ...opts,
    }),
    sharePhoto: useMutation({
      mutationFn: (v: { fileId: string; caption: string }) =>
        source.sharePhoto(projectId, v.fileId, v.caption),
      ...opts,
    }),
    unsharePhoto: useMutation({
      mutationFn: (fileId: string) => source.unsharePhoto(projectId, fileId),
      ...opts,
    }),
    createUpdate: useMutation({
      mutationFn: (v: Parameters<typeof source.createUpdate>[1]) =>
        source.createUpdate(projectId, v),
      ...opts,
    }),
    publishUpdate: useMutation({
      mutationFn: (id: string) => source.publishUpdate(projectId, id),
      ...opts,
    }),
    requestApproval: useMutation({
      mutationFn: (v: Parameters<typeof source.requestApproval>[1]) =>
        source.requestApproval(projectId, v),
      ...opts,
    }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'approved' | 'rejected'; note?: string }) =>
        source.decide(projectId, v.id, v.decision, v.note),
      ...opts,
    }),
    withdraw: useMutation({
      mutationFn: (id: string) => source.withdraw(projectId, id),
      ...opts,
    }),
    updateItem: useMutation({
      mutationFn: (v: {
        id: string;
        version: number;
        body: Parameters<typeof source.updateItem>[3];
      }) => source.updateItem(projectId, v.id, v.version, v.body),
      ...opts,
    }),
    removeItem: useMutation({
      mutationFn: (id: string) => source.removeItem(projectId, id),
      ...opts,
    }),
    addItem: useMutation({
      mutationFn: (v: Parameters<typeof source.addItem>[1]) => source.addItem(projectId, v),
      ...opts,
    }),
  };
}
