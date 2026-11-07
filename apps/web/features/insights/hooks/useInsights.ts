'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createInsightsApi, type InsightKind, type InsightTurn } from '../data/api';

function useInsightsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createInsightsApi(orgId), [orgId]);
}

export function useProjectInsights(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useInsightsApi();
  return useQuery({
    queryKey: ['orgs', orgId, 'projects', projectId, 'insights'],
    queryFn: () => source.insights(projectId),
    staleTime: 60_000,
  });
}

/** Asking Nova changes nothing on the server, so there is nothing to refresh afterwards. */
export function useDiscussInsight(projectId: string) {
  const source = useInsightsApi();
  return useMutation({
    mutationFn: (v: { question: string; insightId?: InsightKind; history: InsightTurn[] }) =>
      source.discuss(projectId, v),
  });
}
