'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createGeotechApi } from '../data/api';
import { geotechPreview, type GeotechSource } from '../data/source';
import type { EarthworksInput, InvestigationInput, TestFilters, TestInput } from '../lib/types';

function useSource(): GeotechSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? geotechPreview : createGeotechApi(orgId)), [orgId]);
}

function useRead<T>(
  part: string,
  fetcher: (s: GeotechSource, projectId: string) => Promise<T>,
  extra = {},
) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'geotech', { part, ...extra }),
    queryFn: () => fetcher(source, projectId),
  });
}

export const useInvestigations = () => useRead('investigations', (s, p) => s.investigations(p));
export const useGeotechTests = (f: TestFilters) =>
  useRead('tests', (s, p) => s.tests(p, f), { ...f });
export const useEarthworks = () => useRead('earthworks', (s, p) => s.earthworks(p));
export const useEarthworksSummary = () => useRead('summary', (s, p) => s.summary(p));
export const useGeotechFlags = () => useRead('flags', (s, p) => s.flags(p));

export function useGeotechMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'geotech') });
    return value;
  };
  return {
    createInvestigation: useMutation({
      mutationFn: async (i: InvestigationInput) =>
        settle(await source.createInvestigation(projectId, i)),
    }),
    createTest: useMutation({
      mutationFn: async (i: TestInput) => settle(await source.createTest(projectId, i)),
    }),
    deleteTest: useMutation({
      mutationFn: async (id: string) => settle(await source.deleteTest(projectId, id)),
    }),
    createEarthworks: useMutation({
      mutationFn: async (i: EarthworksInput) => settle(await source.createEarthworks(projectId, i)),
    }),
    deleteEarthworks: useMutation({
      mutationFn: async (id: string) => settle(await source.deleteEarthworks(projectId, id)),
    }),
  };
}
