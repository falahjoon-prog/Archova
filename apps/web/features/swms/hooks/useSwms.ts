'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createSwmsApi } from '../data/api';
import { swmsPreview, type SwmsSource } from '../data/source';
import type { SwmsDetail, SwmsFilters, SwmsInput, SwmsTransition } from '../lib/types';

function useSource(): SwmsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? swmsPreview : createSwmsApi(orgId)), [orgId]);
}

export function useSwmsList(filters: SwmsFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'swms', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useSwmsDetail(id: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'swms', id),
    queryFn: () => source.get(projectId, id),
    enabled: id !== '',
  });
}

export function useSwmsMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async (d: SwmsDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'swms', d.swms.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'swms') });
    return d;
  };
  return {
    create: useMutation({
      mutationFn: async (input: SwmsInput) => settle(await source.create(projectId, input)),
    }),
    transition: useMutation({
      mutationFn: async (v: { detail: SwmsDetail; input: SwmsTransition }) =>
        settle(await source.transition(projectId, v.detail, v.input)),
    }),
    acknowledge: useMutation({
      mutationFn: async (v: { detail: SwmsDetail; workerName: string }) =>
        settle(await source.acknowledge(projectId, v.detail, v.workerName)),
    }),
  };
}
