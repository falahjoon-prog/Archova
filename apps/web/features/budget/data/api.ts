// Project budget, cost codes and budget adjustments against the financials endpoints (schema/financials "Budget and cost").

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Budget = S['Budget'];
export type BudgetLine = S['BudgetLine'];
export type BudgetAdjustment = S['BudgetAdjustment'];
export type CostCode = S['CostCode'];
export type AddBudgetLine = S['AddBudgetLineRequest'];
export type UpdateBudgetLine = S['UpdateBudgetLineRequest'];
export type AdjustBudgetLine = S['AdjustBudgetLineRequest'];
export type CreateCostCode = S['CreateCostCodeRequest'];
export type UpdateCostCode = S['UpdateCostCodeRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createBudgetApi(orgId: string) {
  return {
    async budget(projectId: string): Promise<Budget> {
      return unwrap(await api.GET(`${P}/budget`, { params: { path: { orgId, projectId } } }));
    },
    async createBudget(projectId: string): Promise<Budget> {
      return unwrap(
        await api.POST(`${P}/budget`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
        }),
      );
    },
    async lock(projectId: string): Promise<Budget> {
      return unwrap(
        await api.POST(`${P}/budget/lock`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
        }),
      );
    },
    async addLine(projectId: string, body: AddBudgetLine): Promise<BudgetLine> {
      return unwrap(
        await api.POST(`${P}/budget/lines`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async updateLine(
      projectId: string,
      lineId: string,
      body: UpdateBudgetLine,
    ): Promise<BudgetLine> {
      return unwrap(
        await api.PATCH(`${P}/budget/lines/{lineId}`, {
          params: { path: { orgId, projectId, lineId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async deleteLine(projectId: string, lineId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/budget/lines/{lineId}`, {
          params: { path: { orgId, projectId, lineId }, header: idempotencyKey() },
        }),
      );
    },
    async adjustments(projectId: string, lineId: string): Promise<BudgetAdjustment[]> {
      return unwrap(
        await api.GET(`${P}/budget/lines/{lineId}/adjustments`, {
          params: { path: { orgId, projectId, lineId } },
        }),
      ).data;
    },
    async adjust(projectId: string, lineId: string, body: AdjustBudgetLine): Promise<BudgetLine> {
      return unwrap(
        await api.POST(`${P}/budget/lines/{lineId}/adjustments`, {
          params: { path: { orgId, projectId, lineId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async costCodes(projectId: string): Promise<CostCode[]> {
      return unwrap(await api.GET(`${P}/cost-codes`, { params: { path: { orgId, projectId } } }))
        .data;
    },
    async createCostCode(projectId: string, body: CreateCostCode): Promise<CostCode> {
      return unwrap(
        await api.POST(`${P}/cost-codes`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async updateCostCode(
      projectId: string,
      costCodeId: string,
      body: UpdateCostCode,
    ): Promise<CostCode> {
      return unwrap(
        await api.PATCH(`${P}/cost-codes/{costCodeId}`, {
          params: { path: { orgId, projectId, costCodeId }, header: idempotencyKey() },
          body,
        }),
      );
    },
  };
}
