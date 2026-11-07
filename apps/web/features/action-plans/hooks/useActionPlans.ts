'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createActionPlansApi } from '../data/api';
import { actionPlansPreview, type ActionPlansSource } from '../data/source';
import type {
  ActionPlanDetail,
  PlanFilters,
  PlanInput,
  PlanPatch,
  StepInput,
  StepPatch,
} from '../lib/types';

function useSource(): ActionPlansSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? actionPlansPreview : createActionPlansApi(orgId)),
    [orgId],
  );
}

export function useActionPlans(filters: PlanFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'action-plans', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useActionPlan(id: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'action-plans', id),
    queryFn: () => source.get(projectId, id),
  });
}

export function usePlanTemplates(enabled: boolean) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'action-plans', { templates: true }),
    queryFn: () => source.templates(projectId),
    enabled,
  });
}

/** Steps are ticked by other companies too, so none of these is optimistic: the screen shows what the server kept. */
export function useActionPlanMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const settle = async (d: ActionPlanDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'action-plans', d.plan.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'action-plans') });
    return d;
  };
  return {
    create: useMutation({
      mutationFn: async (input: PlanInput) => await settle(await source.create(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: { detail: ActionPlanDetail; patch: PlanPatch }) =>
        await settle(await source.update(projectId, v.detail, v.patch)),
    }),
    addStep: useMutation({
      mutationFn: async (v: { planId: string; input: StepInput }) =>
        await settle(await source.addStep(projectId, v.planId, v.input)),
    }),
    updateStep: useMutation({
      mutationFn: async (v: { planId: string; stepId: string; patch: StepPatch }) =>
        await settle(await source.updateStep(projectId, v.planId, v.stepId, v.patch)),
    }),
    saveAsTemplate: useMutation({
      mutationFn: async (v: { planId: string; name: string }) => {
        const t = await source.saveAsTemplate(projectId, v.planId, v.name);
        await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'action-plans') });
        return t;
      },
    }),
  };
}
