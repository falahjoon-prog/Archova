'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createBudgetApi,
  type AddBudgetLine,
  type AdjustBudgetLine,
  type BudgetReviewTurn,
  type CostCodeProduction,
  type CreateCostCode,
  type CostReportColumn,
  type CreateProductionItem,
  type LogProductionEntry,
  type ImportBudgetLinesRequest,
  type LaborTurn,
  type LogQuantity,
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

export function useSnapshots(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { snapshots: true }),
    queryFn: () => source.snapshots(projectId),
  });
}

export function useCreateSnapshot(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; note?: string }) => source.createSnapshot(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}

export function useForecast(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { forecast: true }),
    queryFn: () => source.forecast(projectId),
  });
}

export function useSaveForecast(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (lines: { lineId: string; entries: Record<string, string> }[]) =>
      source.saveForecast(projectId, lines),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}

export function useCostReport(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { costReport: true }),
    queryFn: () => source.costReport(projectId),
  });
}

export function useCostReportItems(
  projectId: string,
  target: { lineId: string; column: CostReportColumn } | null,
) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { costReportItems: target }),
    queryFn: () => source.costReportItems(projectId, target!.lineId, target!.column),
    enabled: target !== null,
  });
}

export function useReviewChecks(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { reviewChecks: true }),
    queryFn: () => source.reviewChecks(projectId),
  });
}

/** Ask Nova about the budget. Nothing is saved, so there is nothing to refresh afterwards. */
export function useAskNovaBudget(projectId: string) {
  const source = useBudgetApi();
  return useMutation({
    mutationFn: (body: { question: string; history: BudgetReviewTurn[] }) =>
      source.askNova(projectId, body),
  });
}

export function useProjectAdjustments(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { projectAdjustments: true }),
    queryFn: () => source.projectAdjustments(projectId),
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
    importLines: useMutation({
      mutationFn: (body: ImportBudgetLinesRequest) => source.importLines(projectId, body),
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

export function useQuantityLog(projectId: string, costCodeId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { quantityLog: costCodeId }),
    queryFn: () => source.quantityLog(projectId, costCodeId),
  });
}

/** Logging quantity moves the code's quantity in place, so the report and its log refresh. */
export function useLogQuantity(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { costCodeId: string; body: LogQuantity }) =>
      source.logQuantity(projectId, v.costCodeId, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}

export function useProductionReport(
  projectId: string,
  filter: { trade?: string; location?: string },
) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { production: filter }),
    queryFn: () => source.productionReport(projectId, filter),
  });
}

export function useCreateProductionItem(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProductionItem) => source.createProductionItem(projectId, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}

export function useProductionEntries(projectId: string, itemId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'budget', { productionEntries: itemId }),
    queryFn: () => source.productionEntries(projectId, itemId),
  });
}

/** Logging quantity moves the item's total, the curve and the rate flags, so the whole report refreshes. */
export function useLogProductionEntry(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useBudgetApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { itemId: string; body: LogProductionEntry }) =>
      source.logProductionEntry(projectId, v.itemId, v.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'budget') }),
  });
}

export function useExportLaborProductivity(projectId: string) {
  const source = useBudgetApi();
  return useMutation({
    mutationFn: (filter: { divisionId?: string; subJobId?: string }) =>
      source.exportLaborProductivity(projectId, filter),
  });
}

/** One turn with Nova about a cost code. The server keeps no conversation; the caller passes `history` back. */
export function useExplainLabor(projectId: string) {
  const source = useBudgetApi();
  return useMutation({
    mutationFn: (v: { costCodeId: string; question?: string; history?: LaborTurn[] }) =>
      source.explainLabor(projectId, v),
  });
}
