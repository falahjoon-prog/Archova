'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { useMemo } from 'react';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  createEstimatesApi,
  type Estimate,
  type EstimateLineInput,
  type EstimateSettingsPatch,
  type NewCostItem,
  type NewCostRate,
} from '../data/estimates-api';

export function useEstimatesApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createEstimatesApi(orgId), [orgId]);
}

const libraryKey = (orgId: string, filters: object = {}) => ['cost-items', orgId, filters] as const;

/** Estimates and the cost library are server-only: preview data has no pricing engine to stand in for it. */
export function useCostItems(q = '') {
  const apiClient = useEstimatesApi();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: libraryKey(orgId, { q }),
    queryFn: () => apiClient.listCostItems(q ? { q } : {}),
    enabled: !previewDataOnly,
  });
}

export function useCostLibraryMutations() {
  const apiClient = useEstimatesApi();
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['cost-items', orgId] });
  return {
    create: useMutation({
      mutationFn: (input: NewCostItem) => apiClient.createCostItem(input),
      onSuccess: refresh,
    }),
    addRate: useMutation({
      mutationFn: (input: { id: string; rate: NewCostRate }) =>
        apiClient.addCostRate(input.id, input.rate),
      onSuccess: refresh,
    }),
  };
}

export function useEstimates() {
  const apiClient = useEstimatesApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'estimates'),
    queryFn: () => apiClient.listEstimates(projectId),
    enabled: !previewDataOnly,
  });
}

export function useEstimate(estimateId: string) {
  const apiClient = useEstimatesApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'estimates', { estimateId }),
    queryFn: () => apiClient.getEstimate(projectId, estimateId),
    enabled: !previewDataOnly,
  });
}

export function useEstimateMutations(estimateId?: string) {
  const apiClient = useEstimatesApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const root = queryKeys.tool(orgId, projectId, 'estimates');
  // Every change returns the whole recalculated sheet, so it replaces what is cached; the list follows.
  const accept = (sheet: Estimate) => {
    qc.setQueryData(
      queryKeys.toolList(orgId, projectId, 'estimates', { estimateId: sheet.id }),
      sheet,
    );
    return qc.invalidateQueries({ queryKey: root });
  };
  const need = () => {
    if (!estimateId) throw new Error('No estimate chosen');
    return estimateId;
  };
  return {
    create: useMutation({
      mutationFn: (input: { name: string }) => apiClient.createEstimate(projectId, input),
      onSuccess: accept,
    }),
    settings: useMutation({
      mutationFn: (input: {
        estimate: Pick<Estimate, 'id' | 'version'>;
        patch: EstimateSettingsPatch;
      }) => apiClient.updateEstimate(projectId, input.estimate, input.patch),
      onSuccess: accept,
    }),
    addLine: useMutation({
      mutationFn: (input: EstimateLineInput) => apiClient.addLine(projectId, need(), input),
      onSuccess: accept,
    }),
    updateLine: useMutation({
      mutationFn: (input: { lineId: string; patch: EstimateLineInput }) =>
        apiClient.updateLine(projectId, need(), input.lineId, input.patch),
      onSuccess: accept,
    }),
    deleteLine: useMutation({
      mutationFn: (lineId: string) => apiClient.deleteLine(projectId, need(), lineId),
      onSuccess: accept,
    }),
    issue: useMutation({
      mutationFn: (estimate: Pick<Estimate, 'id' | 'version'>) =>
        apiClient.issue(projectId, estimate),
      onSuccess: accept,
    }),
    /** Several lines from takeoff in one go; the last response is the finished sheet. */
    addLines: useMutation({
      mutationFn: async (input: { estimateId: string; lines: EstimateLineInput[] }) => {
        let sheet: Estimate | null = null;
        for (const line of input.lines)
          sheet = await apiClient.addLine(projectId, input.estimateId, line);
        return sheet;
      },
      onSuccess: (sheet) => (sheet ? accept(sheet) : undefined),
    }),
  };
}
