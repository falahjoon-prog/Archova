'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createCommitmentsApi, type CreateChangeOrder, type RecordPayment } from '../data/api';

function useCommitmentsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createCommitmentsApi(orgId), [orgId]);
}

export function useCommitments(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useCommitmentSummary(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', { summary: true }),
    queryFn: () => source.summary(projectId),
  });
}

export function useCommitment(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'commitments', commitmentId),
    queryFn: () => source.get(projectId, commitmentId),
  });
}

export function useChangeOrders(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', { commitmentId, cos: true }),
    queryFn: () => source.changeOrders(projectId, commitmentId),
  });
}

export function usePayments(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', { commitmentId, pays: true }),
    queryFn: () => source.payments(projectId, commitmentId),
  });
}

/** Money is never optimistic: each action waits for the server, then refreshes the lists, totals and budget. */
export function useCommitmentMutations(projectId: string, commitmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useCommitmentsApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'commitments') }),
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
    ]);
  return {
    createChangeOrder: useMutation({
      mutationFn: (body: CreateChangeOrder) =>
        source.createChangeOrder(projectId, commitmentId, body),
      onSuccess: refresh,
    }),
    moveChangeOrder: useMutation({
      mutationFn: (v: {
        changeOrderId: string;
        to: 'submit' | 'approve' | 'reject';
        note?: string;
      }) => source.moveChangeOrder(projectId, commitmentId, v.changeOrderId, v.to, v.note),
      onSuccess: refresh,
    }),
    recordPayment: useMutation({
      mutationFn: (body: RecordPayment) => source.recordPayment(projectId, commitmentId, body),
      onSuccess: refresh,
    }),
    voidPayment: useMutation({
      mutationFn: (v: { paymentId: string; note: string }) =>
        source.voidPayment(projectId, commitmentId, v.paymentId, v.note),
      onSuccess: refresh,
    }),
  };
}
