'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createClaimsApi,
  type CreateContract,
  type CreateForecastAdjustment,
  type CreateVariation,
  type IssuePaymentSchedule,
  type PaymentClaimStatus,
  type SubmitPaymentClaim,
  type VariationAction,
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

export function useCostForecast(projectId: string, enabled = true) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'cost-forecast', {}),
    queryFn: () => source.costForecast(projectId),
    enabled,
  });
}

export function useBudgetVsForecast(projectId: string, enabled = true) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'cost-forecast', { view: 'budget' }),
    queryFn: () => source.budgetVsForecast(projectId),
    enabled,
  });
}

/** The forecast is derived from contracts and claims, so a change to either is also a change to it. */
export function useForecastMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'cost-forecast') });
  return {
    createAdjustment: useMutation({
      mutationFn: (body: CreateForecastAdjustment) => source.createAdjustment(projectId, body),
      onSuccess: refresh,
    }),
    deleteAdjustment: useMutation({
      mutationFn: (adjustmentId: string) => source.deleteAdjustment(projectId, adjustmentId),
      onSuccess: refresh,
    }),
  };
}

export function useVariations(projectId: string, contractId: string) {
  const { orgId } = useCurrentOrg();
  const source = useClaimsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'contracts', { variations: contractId }),
    queryFn: () => source.variations(projectId, contractId),
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
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'cost-forecast') }),
    ]);
  return {
    createContract: useMutation({
      mutationFn: (body: CreateContract) => source.createContract(projectId, body),
      onSuccess: refresh,
    }),
    createVariation: useMutation({
      mutationFn: (v: { contractId: string; body: CreateVariation }) =>
        source.createVariation(projectId, v.contractId, v.body),
      onSuccess: refresh,
    }),
    moveVariation: useMutation({
      mutationFn: (v: { variationId: string; action: VariationAction; note?: string }) =>
        source.moveVariation(projectId, v.variationId, v.action, v.note),
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
