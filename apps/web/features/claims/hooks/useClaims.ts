'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createClaimsApi,
  type CreateContract,
  type IssuePaymentSchedule,
  type PaymentClaimStatus,
  type SubmitPaymentClaim,
} from '../data/api';

function useClaimsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createClaimsApi(orgId), [orgId]);
}

export function useContracts(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'contracts', {}),
    queryFn: () => source.contracts(projectId),
  });
}

export function useContract(projectId: string, contractId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'contracts', contractId),
    queryFn: () => source.contract(projectId, contractId),
  });
}

export function useClaimsRegister(projectId: string, status?: PaymentClaimStatus) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'payment-claims', { status }),
    queryFn: () => source.claims(projectId, status),
  });
}

export function usePaymentClaim(projectId: string, claimId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'payment-claims', claimId),
    queryFn: () => source.claim(projectId, claimId),
  });
}

/** Money and statutory dates are never optimistic: each action waits for the server and then refreshes both lists. */
export function useClaimsMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'contracts') }),
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'payment-claims') }),
    ]);
  return {
    createContract: useMutation({
      mutationFn: (body: CreateContract) => source.createContract(projectId, body),
      onSuccess: refresh,
    }),
    submitClaim: useMutation({
      mutationFn: (v: { contractId: string; body: SubmitPaymentClaim }) =>
        source.submitClaim(projectId, v.contractId, v.body),
      onSuccess: refresh,
    }),
    issueSchedule: useMutation({
      mutationFn: (v: { claimId: string; body: IssuePaymentSchedule }) =>
        source.issueSchedule(projectId, v.claimId, v.body),
      onSuccess: refresh,
    }),
  };
}
