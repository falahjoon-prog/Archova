'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createEnvironmentApi } from '../data/api';
import { environmentPreview, type EnvironmentSource } from '../data/source';
import type {
  Condition,
  ConditionFilters,
  ConditionInput,
  DocumentInput,
  EnvironmentDocument,
  Plan,
  PlanInput,
  TransitionInput,
} from '../lib/types';

function useSource(): EnvironmentSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? environmentPreview : createEnvironmentApi(orgId)),
    [orgId],
  );
}

export function useEnvironmentSummary() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'summary' }),
    queryFn: () => source.summary(projectId),
  });
}

export function useConditions(filters: ConditionFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', {
      view: 'conditions',
      ...filters,
    }),
    queryFn: () => source.listConditions(projectId, filters),
  });
}

export function useConditionDetail(id: string | null) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'environment', id ?? ''),
    queryFn: () => source.getCondition(projectId, id!),
    enabled: id !== null,
  });
}

export function useEnvironmentDocuments() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'documents' }),
    queryFn: () => source.listDocuments(projectId),
  });
}

/** Status changes are seen by others and feed the summary, so none is optimistic. */
export function useEnvironmentMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the register to refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'environment') });
    return value;
  };
  return {
    createCondition: useMutation({
      mutationFn: async (input: ConditionInput) =>
        await settle(await source.createCondition(projectId, input)),
    }),
    starterPack: useMutation({
      mutationFn: async () => await settle(await source.applyStarterPack(projectId)),
    }),
    transition: useMutation({
      mutationFn: async (v: { condition: Condition; input: TransitionInput }) =>
        await settle(await source.transition(projectId, v.condition, v.input)),
    }),
    createDocument: useMutation({
      mutationFn: async (input: DocumentInput) =>
        await settle(await source.createDocument(projectId, input)),
    }),
    deleteDocument: useMutation({
      mutationFn: async (d: EnvironmentDocument) =>
        await settle(await source.deleteDocument(projectId, d)),
    }),
    createPlan: useMutation({
      mutationFn: async (input: PlanInput) =>
        await settle(await source.createPlan(projectId, input)),
    }),
    approvePlan: useMutation({
      mutationFn: async (plan: Plan) => await settle(await source.approvePlan(projectId, plan)),
    }),
  };
}
