'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createItpApi, type CreateItpInput, type ItpApi } from '../data/api';

function useItpApi(projectId: string): ItpApi {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createItpApi({ orgId, projectId }), [orgId, projectId]);
}

export function useItpPackages(projectId: string) {
  const { orgId } = useCurrentOrg();
  const itp = useItpApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { itp: 'list' }),
    queryFn: () => itp.list(),
  });
}

export function useItpPackage(projectId: string, itpId: string | null) {
  const { orgId } = useCurrentOrg();
  const itp = useItpApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { itp: itpId }),
    queryFn: () => itp.get(itpId!),
    enabled: itpId !== null,
  });
}

export function useItpDocuments(projectId: string, enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const itp = useItpApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { itp: 'documents' }),
    queryFn: () => itp.documents(),
    enabled,
    staleTime: 60_000,
  });
}

function useItpMutation<V>(projectId: string, fn: (api: ItpApi, input: V) => Promise<unknown>) {
  const { orgId } = useCurrentOrg();
  const itp = useItpApi(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: V) => fn(itp, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'documents') }),
  });
}

export const useCreateItp = (projectId: string) =>
  useItpMutation(projectId, (a, input: CreateItpInput) => a.create(input));
export const useActivateItp = (projectId: string) =>
  useItpMutation(projectId, (a, itpId: string) => a.activate(itpId));
export const useSignItpItem = (projectId: string) =>
  useItpMutation(
    projectId,
    (
      a,
      v: {
        itpId: string;
        itemId: string;
        status: 'pending' | 'passed' | 'failed' | 'waived';
        note: string | null;
      },
    ) => a.sign(v.itpId, v.itemId, { status: v.status, note: v.note }),
  );
