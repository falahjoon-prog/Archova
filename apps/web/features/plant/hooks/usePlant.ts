'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createPlantApi,
  type CompletePlantPlan,
  type CreatePlantAllocation,
  type CreatePlantAsset,
  type CreatePlantPlan,
  type PlantAssetStatus,
} from '../data/api';

const key = (orgId: string, ...rest: unknown[]) => ['orgs', orgId, 'plant', ...rest] as const;

export function usePlantData(from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createPlantApi(orgId), [orgId]);
  return {
    assets: useQuery({ queryKey: key(orgId, 'assets'), queryFn: () => source.assets() }),
    allocations: useQuery({
      queryKey: key(orgId, 'allocations', from, to),
      queryFn: () => source.allocations(from, to),
    }),
    plans: useQuery({ queryKey: key(orgId, 'plans'), queryFn: () => source.plans() }),
    flags: useQuery({ queryKey: key(orgId, 'flags'), queryFn: () => source.flags() }),
  };
}

export function usePlantUtilisation(from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createPlantApi(orgId), [orgId]);
  return useQuery({
    queryKey: key(orgId, 'utilisation', from, to),
    queryFn: () => source.utilisation(from, to),
  });
}

export function usePlantMutations() {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createPlantApi(orgId), [orgId]);
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: key(orgId) });
  return {
    createAsset: useMutation({
      mutationFn: (body: CreatePlantAsset) => source.createAsset(body),
      onSuccess: refresh,
    }),
    setStatus: useMutation({
      mutationFn: (v: { assetId: string; status: PlantAssetStatus }) =>
        source.setStatus(v.assetId, v.status),
      onSuccess: refresh,
    }),
    allocate: useMutation({
      mutationFn: (v: { assetId: string; body: CreatePlantAllocation }) =>
        source.allocate(v.assetId, v.body),
      onSuccess: refresh,
    }),
    cancelAllocation: useMutation({
      mutationFn: (allocationId: string) => source.cancelAllocation(allocationId),
      onSuccess: refresh,
    }),
    createPlan: useMutation({
      mutationFn: (v: { assetId: string; body: CreatePlantPlan }) =>
        source.createPlan(v.assetId, v.body),
      onSuccess: refresh,
    }),
    completePlan: useMutation({
      mutationFn: (v: { planId: string; body: CompletePlantPlan }) =>
        source.completePlan(v.planId, v.body),
      onSuccess: refresh,
    }),
  };
}
