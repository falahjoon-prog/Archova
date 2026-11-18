'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createCommitmentsApi } from '../data/api';

export function useCommitments(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createCommitmentsApi(orgId), [orgId]);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', {}),
    queryFn: () => source.list(projectId),
  });
}

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createCommitmentsApi(orgId), [orgId]);
}

export function useCommitment(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', { id: commitmentId }),
    queryFn: () => source.get(projectId, commitmentId),
  });
}

export function useCommitmentInvoices(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', {
      id: commitmentId,
      view: 'invoices',
    }),
    queryFn: () => source.invoices(projectId, commitmentId),
  });
}

export function useLinkCommitmentContract(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (contractId: string | null) =>
      source.linkContract(projectId, commitmentId, contractId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'commitments') }),
  });
}
