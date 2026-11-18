// Prefabricated and modular units, their QA checks and Nova's board checks against the prefab endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Unit = S['PrefabUnit'];
export type UnitKind = S['PrefabUnitKind'];
export type UnitStatus = S['PrefabUnitStatus'];
export type UnitDetail = S['PrefabUnitDetail'];
export type Check = S['PrefabCheck'];
export type Flag = S['PrefabFlag'];
export type Insights = S['PrefabInsights'];
export type DatePlan = S['PrefabDatePlan'];
export type CreateUnit = S['CreatePrefabUnitRequest'];
export type UpdateUnit = S['UpdatePrefabUnitRequest'];
export type Transition = S['PrefabTransitionRequest'];
export type PlanRequest = S['PrefabPlanDatesRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/prefab' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createPrefabApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  const withUnit = (projectId: string, unitId: string) => ({ ...path(projectId), unitId });
  return {
    async list(projectId: string): Promise<Unit[]> {
      return unwrap(await api.GET(`${P}/units`, { params: { path: path(projectId) } })).data;
    },
    async get(projectId: string, unitId: string): Promise<UnitDetail> {
      return unwrap(
        await api.GET(`${P}/units/{unitId}`, {
          params: { path: withUnit(projectId, unitId) },
        }),
      );
    },
    async create(projectId: string, body: CreateUnit): Promise<Unit> {
      return unwrap(
        await api.POST(`${P}/units`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async update(projectId: string, unitId: string, body: UpdateUnit): Promise<Unit> {
      return unwrap(
        await api.PATCH(`${P}/units/{unitId}`, {
          params: { path: withUnit(projectId, unitId) },
          body,
        }),
      );
    },
    async transition(projectId: string, unitId: string, body: Transition): Promise<Unit> {
      return unwrap(
        await api.POST(`${P}/units/{unitId}/transitions`, {
          params: { path: withUnit(projectId, unitId) },
          body,
        }),
      );
    },
    async recordCheck(
      projectId: string,
      unitId: string,
      checkId: string,
      body: S['RecordPrefabCheckRequest'],
    ): Promise<Check> {
      return unwrap(
        await api.PATCH(`${P}/units/{unitId}/checks/{checkId}`, {
          params: { path: { ...withUnit(projectId, unitId), checkId } },
          body,
        }),
      );
    },
    async addCheck(
      projectId: string,
      unitId: string,
      body: S['AddPrefabCheckRequest'],
    ): Promise<Check> {
      return unwrap(
        await api.POST(`${P}/units/{unitId}/checks`, {
          params: { path: withUnit(projectId, unitId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async insights(projectId: string): Promise<Insights> {
      return unwrap(await api.GET(`${P}/insights`, { params: { path: path(projectId) } }));
    },
    async planDates(projectId: string, body: PlanRequest): Promise<DatePlan> {
      return unwrap(await api.POST(`${P}/plan-dates`, { params: { path: path(projectId) }, body }));
    },
  };
}
