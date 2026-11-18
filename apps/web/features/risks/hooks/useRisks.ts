'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createRisksApi, type CreateRisk, type UpdateRisk } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createRisksApi(orgId), [orgId]);
}

export function useRisks() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'risks', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useRiskSummary() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'risks', { summary: true }),
    queryFn: () => source.summary(projectId),
  });
}

export function useRiskMutations() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  const qc = useQueryClient();
  const settle = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'risks') });
  return {
    create: useMutation({
      mutationFn: (body: CreateRisk) => source.create(projectId, body),
      onSuccess: settle,
    }),
    update: useMutation({
      mutationFn: (v: { risk: { id: string; version: number }; body: UpdateRisk }) =>
        source.update(projectId, v.risk, v.body),
      onSuccess: settle,
    }),
    remove: useMutation({
      mutationFn: (riskId: string) => source.remove(projectId, riskId),
      onSuccess: settle,
    }),
  };
}
