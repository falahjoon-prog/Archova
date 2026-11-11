'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createProjectPlanApi, type ItemPatch, type NewItem } from '../data/api';
import type { LinkType, ProjectPlan } from '../lib/labels';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createProjectPlanApi(orgId), [orgId]);
}

export function useProjectPlan() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'project-plan', {}),
    queryFn: () => api.get(projectId),
  });
}

export function usePlanInsights(enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'project-plan', { insights: true }),
    queryFn: () => api.insights(projectId),
    enabled,
  });
}

export function useLinkOptions(itemId: string, type: LinkType | null, q: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'project-plan', {
      options: `${itemId}:${type}:${q}`,
    }),
    queryFn: () => api.linkOptions(projectId, itemId, type!, q || undefined),
    enabled: type !== null,
  });
}

/** None of these is optimistic: other people tick items and clear holds too, so the screen shows what the server kept. */
export function usePlanMutations() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const api = useApi();
  const qc = useQueryClient();
  const settle = async (plan: ProjectPlan) => {
    qc.setQueryData(queryKeys.toolList(orgId, projectId, 'project-plan', {}), plan);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'project-plan') });
    return plan;
  };
  return {
    start: useMutation({ mutationFn: async () => settle(await api.start(projectId)) }),
    addPhase: useMutation({
      mutationFn: async (title: string) => settle(await api.addPhase(projectId, title)),
    }),
    updatePhase: useMutation({
      mutationFn: async (v: { phaseId: string; title?: string; position?: number }) =>
        settle(
          await api.updatePhase(projectId, v.phaseId, {
            ...(v.title !== undefined ? { title: v.title } : {}),
            ...(v.position !== undefined ? { position: v.position } : {}),
          }),
        ),
    }),
    deletePhase: useMutation({
      mutationFn: async (phaseId: string) => settle(await api.deletePhase(projectId, phaseId)),
    }),
    addItem: useMutation({
      mutationFn: async (v: { phaseId: string; input: NewItem }) =>
        settle(await api.addItem(projectId, v.phaseId, v.input)),
    }),
    updateItem: useMutation({
      mutationFn: async (v: { itemId: string; patch: ItemPatch }) =>
        settle(await api.updateItem(projectId, v.itemId, v.patch)),
    }),
    deleteItem: useMutation({
      mutationFn: async (itemId: string) => settle(await api.deleteItem(projectId, itemId)),
    }),
    clearHold: useMutation({
      mutationFn: async (v: { itemId: string; note?: string }) =>
        settle(await api.clearHold(projectId, v.itemId, v.note)),
    }),
    request: useMutation({
      mutationFn: async (v: {
        itemId: string;
        kind: 'attachment' | 'photo';
        message?: string;
        assigneeUserId?: string;
      }) => settle(await api.request(projectId, v.itemId, v)),
    }),
    summary: useMutation({
      mutationFn: async (phaseId: string) => api.phaseSummary(projectId, phaseId),
    }),
  };
}
