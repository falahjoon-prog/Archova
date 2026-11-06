'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createBudgetApi,
  type AddBudgetLine,
  type AdjustBudgetLine,
  type CostCodeProduction,
  type CreateCostCode,
  type RecordDirectCost,
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

export function useDirectCosts(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { directCosts: true }),
    queryFn: () => source.directCosts(projectId),
  });
}

/** Recording or voiding a cost moves a line's actual, so the budget and the forecast refresh with the list. */
export function useDirectCostMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'cost-forecast') }),
    ]);
  return {
    record: useMutation({
      mutationFn: (body: RecordDirectCost) => source.recordDirectCost(projectId, body),
      onSuccess: refresh,
    }),
    voidCost: useMutation({
      mutationFn: (v: { directCostId: string; note: string }) =>
        source.voidDirectCost(projectId, v.directCostId, v.note),
      onSuccess: refresh,
    }),
  };
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

export function useLaborProductivity(
  projectId: string,
  filter: { divisionId?: string; subJobId?: string },
) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { productivity: filter }),
    queryFn: () => source.laborProductivity(projectId, filter),
  });
}

/** Saving a plan or the quantity in place refreshes the report. */
export function useSetProduction(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { costCodeId: string; body: CostCodeProduction }) =>
      source.setProduction(projectId, v.costCodeId, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}
