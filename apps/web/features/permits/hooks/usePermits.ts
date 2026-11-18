'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createPermitsApi } from '../data/api';
import { permitsPreview, type PermitSource } from '../data/source';
import type { Permit, PermitAction, PermitFilters, PermitInput, Requirement } from '../lib/types';

function useSource(): PermitSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? permitsPreview : createPermitsApi(orgId)), [orgId]);
}

export function usePermitList(filters: PermitFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'permits', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function usePermitFlags() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'permits', { flags: true }),
    queryFn: () => source.flags(projectId),
  });
}

export function usePermitRequirements(enabled = true) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'permits', { requirements: true }),
    queryFn: () => source.requirements(projectId),
    enabled,
  });
}

export function usePermitMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'permits') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: PermitInput) => settle(await source.create(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: { permit: Permit; input: Partial<PermitInput> }) =>
        settle(await source.update(projectId, v.permit, v.input)),
    }),
    transition: useMutation({
      mutationFn: async (v: {
        permit: Permit;
        input: { action: PermitAction; newExpiresOn?: string };
      }) => settle(await source.transition(projectId, v.permit, v.input)),
    }),
    setRequirements: useMutation({
      mutationFn: async (items: Requirement[]) =>
        settle(await source.setRequirements(projectId, items)),
    }),
  };
}
