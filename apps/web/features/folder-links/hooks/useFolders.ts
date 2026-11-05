'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createFoldersApi, type Provider } from '../data/api';

const orgKey = (orgId: string) => ['orgs', orgId, 'folders'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createFoldersApi(orgId), [orgId]);
}

export function useFolderConnections() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: [...orgKey(orgId), 'connections'],
    queryFn: () => source.connections(),
  });
}

/** Asks for the sign-in or consent address; the caller sends the browser there. */
export function useStartFolderConnection() {
  const source = useApi();
  return useMutation({
    mutationFn: (v: { provider: Provider; tenantId?: string }) =>
      source.start(v.provider, v.tenantId),
  });
}

export function useDisconnectFolders(provider: Provider) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.disconnect(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: orgKey(orgId) }),
  });
}

export function useFolderLinks() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: [...orgKey(orgId), 'links', projectId],
    queryFn: () => source.links(projectId),
  });
}

export function useCreateFolderLink() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { provider: Provider; url?: string }) => source.link(projectId, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...orgKey(orgId), 'links', projectId] }),
  });
}

export function useRemoveFolderLink() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => source.unlink(projectId, linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...orgKey(orgId), 'links', projectId] }),
  });
}
