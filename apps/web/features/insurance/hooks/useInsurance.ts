'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createInsuranceApi } from '../data/api';
import { insurancePreview, type CoverSource } from '../data/source';
import type { Cover, CoverAction, CoverFilters, CoverInput, Requirement } from '../lib/types';

function useSource(): CoverSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? insurancePreview : createInsuranceApi(orgId)), [orgId]);
}

export function useCoverList(filters: CoverFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'insurance', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useCoverFlags() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'insurance', { flags: true }),
    queryFn: () => source.flags(projectId),
  });
}

export function useCoverRequirements(enabled = true) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'insurance', { requirements: true }),
    queryFn: () => source.requirements(projectId),
    enabled,
  });
}

export function useCoverMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'insurance') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: CoverInput) => settle(await source.create(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: { cover: Cover; input: Partial<CoverInput> }) =>
        settle(await source.update(projectId, v.cover, v.input)),
    }),
    transition: useMutation({
      mutationFn: async (v: {
        cover: Cover;
        input: { action: CoverAction; newExpiresOn?: string };
      }) => settle(await source.transition(projectId, v.cover, v.input)),
    }),
    setRequirements: useMutation({
      mutationFn: async (items: Requirement[]) =>
        settle(await source.setRequirements(projectId, items)),
    }),
  };
}
