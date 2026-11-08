// The organisation's fleet of plant and equipment against the plant endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type PlantAsset = S['PlantAsset'];
export type PlantAssetCategory = S['PlantAssetCategory'];
export type PlantAssetStatus = S['PlantAssetStatus'];
export type PlantAllocation = S['PlantAllocation'];
export type PlantPlan = S['PlantMaintenancePlan'];
export type PlantFlag = S['PlantFlag'];
export type PlantUtilisation = S['PlantUtilisation'];
export type CreatePlantAsset = S['CreatePlantAssetRequest'];
export type CreatePlantAllocation = S['CreatePlantAllocationRequest'];
export type CreatePlantPlan = S['CreatePlantMaintenancePlanRequest'];
export type CompletePlantPlan = S['CompletePlantMaintenanceRequest'];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createPlantApi(orgId: string) {
  const org = { orgId };
  return {
    async assets(): Promise<PlantAsset[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/plant/assets', { params: { path: org } })).data;
    },
    async createAsset(body: CreatePlantAsset): Promise<PlantAsset> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/plant/assets', {
          params: { path: org, header: idempotencyKey() },
          body,
        }),
      );
    },
    async setStatus(assetId: string, status: PlantAssetStatus): Promise<PlantAsset> {
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/plant/assets/{assetId}', {
          params: { path: { ...org, assetId } },
          body: { status },
        }),
      );
    },
    async allocations(from: string, to: string): Promise<PlantAllocation[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/plant/allocations', {
          params: { path: org, query: { from, to } },
        }),
      ).data;
    },
    async allocate(assetId: string, body: CreatePlantAllocation): Promise<PlantAllocation> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/plant/assets/{assetId}/allocations', {
          params: { path: { ...org, assetId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async cancelAllocation(allocationId: string): Promise<PlantAllocation> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/plant/allocations/{allocationId}/cancel', {
          params: { path: { ...org, allocationId } },
        }),
      );
    },
    async plans(): Promise<PlantPlan[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/plant/maintenance-plans', { params: { path: org } }),
      ).data;
    },
    async createPlan(assetId: string, body: CreatePlantPlan): Promise<PlantPlan> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/plant/assets/{assetId}/maintenance-plans', {
          params: { path: { ...org, assetId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async completePlan(planId: string, body: CompletePlantPlan): Promise<PlantPlan> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/plant/maintenance-plans/{planId}/complete', {
          params: { path: { ...org, planId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async utilisation(from: string, to: string): Promise<PlantUtilisation> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/plant/utilisation', {
          params: { path: org, query: { from, to } },
        }),
      );
    },
    async flags(): Promise<PlantFlag[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/plant/flags', { params: { path: org, query: {} } }),
      ).data;
    },
  };
}
