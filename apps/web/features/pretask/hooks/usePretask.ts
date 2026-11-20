'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createPretaskApi } from '../data/api';
import { pretaskPreview, type PretaskSource } from '../data/source';
import type { Hazard, PlanDetail, PlanInput, Template, TemplateInput } from '../lib/types';

function useSource(): PretaskSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? pretaskPreview : createPretaskApi(orgId)), [orgId]);
}

function useScope() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return { orgId, projectId };
}

export function usePlanList() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'pretask', { view: 'plans' }),
    queryFn: () => source.listPlans(projectId),
  });
}

export function usePlanDetail(id: string) {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'pretask', id),
    queryFn: () => source.getPlan(projectId, id),
    enabled: id !== '',
  });
}

/** Nova's hazard suggestions for a new plan (`swmsId`) or one being edited (`planId`). */
export function useHazardSuggestions(opts: { planId?: string; swmsId?: string }) {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'pretask', { view: 'suggestions', ...opts }),
    queryFn: () => source.suggestions(projectId, opts),
  });
}

export function useTemplates() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'pretask', { view: 'templates' }),
    queryFn: () => source.listTemplates(projectId),
  });
}

export function useInsights() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'pretask', { view: 'insights' }),
    queryFn: () => source.insights(projectId),
  });
}

export function useSwmsOptions() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'pretask', { view: 'swms' }),
    queryFn: () => source.listSwms(projectId),
  });
}

export function usePretaskMutations() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never carries a stale version.
  const settle = async (d: PlanDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'pretask', d.plan.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'pretask') });
    return d;
  };
  return {
    createPlan: useMutation({
      mutationFn: async (input: PlanInput) => settle(await source.createPlan(projectId, input)),
    }),
    copyPlan: useMutation({
      mutationFn: async (d: PlanDetail) => settle(await source.copyPlan(projectId, d)),
    }),
    createTemplate: useMutation({
      mutationFn: async (input: TemplateInput) => {
        const t = await source.createTemplate(projectId, input);
        await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'pretask') });
        return t;
      },
    }),
    setTemplateActive: useMutation({
      mutationFn: async (v: { template: Template; isActive: boolean }) => {
        const t = await source.setTemplateActive(projectId, v.template, v.isActive);
        await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'pretask') });
        return t;
      },
    }),
    setHazards: useMutation({
      mutationFn: async (v: { detail: PlanDetail; hazards: Hazard[] }) =>
        settle(await source.setHazards(projectId, v.detail, v.hazards)),
    }),
    transition: useMutation({
      mutationFn: async (v: { detail: PlanDetail; action: 'close' | 'reopen' }) =>
        settle(await source.transition(projectId, v.detail, v.action)),
    }),
    review: useMutation({
      mutationFn: async (v: { detail: PlanDetail; note: string | null }) =>
        settle(await source.review(projectId, v.detail, v.note)),
    }),
    addCrew: useMutation({
      mutationFn: async (v: {
        detail: PlanDetail;
        people: { personName: string; companyId?: string }[];
      }) => settle(await source.addCrew(projectId, v.detail, v.people)),
    }),
    removeCrew: useMutation({
      mutationFn: async (v: { detail: PlanDetail; crewId: string }) =>
        settle(await source.removeCrew(projectId, v.detail, v.crewId)),
    }),
    sign: useMutation({
      mutationFn: async (v: { detail: PlanDetail; crewId: string; image: Blob }) =>
        settle(await source.sign(projectId, v.detail, v.crewId, v.image)),
    }),
    clearSignature: useMutation({
      mutationFn: async (v: { detail: PlanDetail; crewId: string }) =>
        settle(await source.clearSignature(projectId, v.detail, v.crewId)),
    }),
  };
}
