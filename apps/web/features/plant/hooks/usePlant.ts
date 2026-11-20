'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { uploadFile } from '@/shared/lib/uploads';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createPlantApi,
  type CompletePlantPlan,
  type CreatePlantAllocation,
  type CreatePlantAsset,
  type CreatePlantPlan,
  type PlantConditionKind,
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

/** The project's cost codes, for tagging an allocation. Empty when the caller can't read the project's budget. */
export function useCostCodes(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createPlantApi(orgId), [orgId]);
  return useQuery({
    queryKey: key(orgId, 'cost-codes', projectId),
    queryFn: () => source.costCodes(projectId).catch(() => []),
    enabled: projectId !== '',
  });
}

/** Condition photos of one machine, newest first. Off until a machine is chosen. */
export function useConditionChecks(assetId: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createPlantApi(orgId), [orgId]);
  return useQuery({
    queryKey: key(orgId, 'condition', assetId),
    queryFn: () => source.conditionChecks(assetId),
    enabled: assetId !== '',
  });
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
    /** Uploads each photo as an org-level plant file (the camera on a phone), then records the check. */
    recordCondition: useMutation({
      mutationFn: async (v: {
        assetId: string;
        kind: PlantConditionKind;
        files: File[];
        note?: string;
      }) => {
        const fileIds: string[] = [];
        for (const file of v.files) {
          fileIds.push((await uploadFile(orgId, { file, module: 'plant' })).id);
        }
        return source.createConditionCheck(v.assetId, {
          kind: v.kind,
          fileIds,
          ...(v.note ? { note: v.note } : {}),
        });
      },
      onSuccess: refresh,
    }),
    completePlan: useMutation({
      mutationFn: (v: { planId: string; body: CompletePlantPlan }) =>
        source.completePlan(v.planId, v.body),
      onSuccess: refresh,
    }),
  };
}
