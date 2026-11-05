'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createBudgetApi,
  type AddBudgetLine,
  type AdjustBudgetLine,
  type CreateCostCode,
  type UpdateBudgetLine,
  type UpdateCostCode,
} from '../data/api';

function useBudgetApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createBudgetApi(orgId), [orgId]);
}

export function useBudget(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', {}),
    queryFn: () => source.budget(projectId),
  });
}

export function useCostCodes(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { costCodes: true }),
    queryFn: () => source.costCodes(projectId),
  });
}

export function useAdjustments(projectId: string, lineId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'budget', lineId),
    queryFn: () => source.adjustments(projectId, lineId),
  });
}

/** Money is never optimistic: each action waits for the server, then refreshes the budget, codes and history. */
export function useBudgetMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') });
  return {
    createBudget: useMutation({
      mutationFn: () => source.createBudget(projectId),
      onSuccess: refresh,
    }),
    lock: useMutation({ mutationFn: () => source.lock(projectId), onSuccess: refresh }),
    addLine: useMutation({
      mutationFn: (body: AddBudgetLine) => source.addLine(projectId, body),
      onSuccess: refresh,
    }),
    updateLine: useMutation({
      mutationFn: (v: { lineId: string; body: UpdateBudgetLine }) =>
        source.updateLine(projectId, v.lineId, v.body),
      onSuccess: refresh,
    }),
    deleteLine: useMutation({
      mutationFn: (lineId: string) => source.deleteLine(projectId, lineId),
      onSuccess: refresh,
    }),
    adjust: useMutation({
      mutationFn: (v: { lineId: string; body: AdjustBudgetLine }) =>
        source.adjust(projectId, v.lineId, v.body),
      onSuccess: refresh,
    }),
    createCostCode: useMutation({
      mutationFn: (body: CreateCostCode) => source.createCostCode(projectId, body),
      onSuccess: refresh,
    }),
    updateCostCode: useMutation({
      mutationFn: (v: { costCodeId: string; body: UpdateCostCode }) =>
        source.updateCostCode(projectId, v.costCodeId, v.body),
      onSuccess: refresh,
    }),
  };
}
