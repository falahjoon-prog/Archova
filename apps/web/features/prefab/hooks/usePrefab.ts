'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createPrefabApi, type CreateUnit, type PlanRequest, type Transition } from '../data/api';

function usePrefabApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createPrefabApi(orgId), [orgId]);
}

export function usePrefabUnits(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = usePrefabApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'prefab', { view: 'list' }),
    queryFn: () => source.list(projectId),
  });
}

export function usePrefabDetail(projectId: string, unitId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = usePrefabApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'prefab', { view: 'detail', unitId }),
    queryFn: () => source.get(projectId, unitId!),
    enabled: unitId !== null,
  });
}

export function usePrefabInsights(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = usePrefabApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'prefab', { view: 'insights' }),
    queryFn: () => source.insights(projectId),
    // The flags depend on the date, so look again every few minutes while the board is open.
    refetchInterval: 5 * 60_000,
  });
}

export function usePrefabMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = usePrefabApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'prefab') });
  return {
    create: useMutation({
      mutationFn: (body: CreateUnit) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    transition: useMutation({
      mutationFn: (v: { unitId: string; body: Transition }) =>
        source.transition(projectId, v.unitId, v.body),
      onSuccess: refresh,
    }),
    progress: useMutation({
      mutationFn: (v: { unitId: string; progressPct: number }) =>
        source.update(projectId, v.unitId, { progressPct: v.progressPct }),
      onSuccess: refresh,
    }),
    recordCheck: useMutation({
      mutationFn: (v: {
        unitId: string;
        checkId: string;
        result: 'pending' | 'pass' | 'fail' | 'na';
        note?: string;
      }) =>
        source.recordCheck(projectId, v.unitId, v.checkId, {
          result: v.result,
          ...(v.note ? { note: v.note } : {}),
        }),
      onSuccess: refresh,
    }),
    addCheck: useMutation({
      mutationFn: (v: { unitId: string; stage: 'factory' | 'site'; label: string }) =>
        source.addCheck(projectId, v.unitId, { stage: v.stage, label: v.label }),
      onSuccess: refresh,
    }),
    planDates: useMutation({
      mutationFn: (body: PlanRequest) => source.planDates(projectId, body),
    }),
  };
}
