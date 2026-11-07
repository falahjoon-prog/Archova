// Project budget, cost codes and budget adjustments against the financials endpoints (schema/financials "Budget and cost").

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

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
export type BudgetSnapshot = S['BudgetSnapshot'];
export type ImportBudgetLinesRequest = S['ImportBudgetLinesRequest'];
export type DirectCost = S['DirectCost'];
export type DirectCostList = S['DirectCostList'];
export type LaborProductivity = S['LaborProductivity'];
export type LaborProductivityRow = S['LaborProductivityRow'];
export type CostCodeProduction = S['CostCodeProduction'];
export type ProductionLogEntry = S['ProductionLogEntry'];
export type LogQuantity = S['LogQuantityRequest'];
export type LaborTurn = S['LaborTurn'];
export type LaborExplanation = S['LaborProductivityExplanation'];
export type RecordDirectCost = S['RecordDirectCostRequest'];

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
    async laborProductivity(
      projectId: string,
      filter: { divisionId?: string; subJobId?: string },
    ): Promise<LaborProductivity> {
      return unwrap(
        await api.GET(`${P}/reports/labor-productivity`, {
          params: { path: { orgId, projectId }, query: filter },
        }),
      );
    },
    async setProduction(projectId: string, costCodeId: string, body: CostCodeProduction) {
      return unwrap(
        await api.PUT(`${P}/cost-codes/{costCodeId}/production`, {
          params: { path: { orgId, projectId, costCodeId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async quantityLog(projectId: string, costCodeId: string): Promise<ProductionLogEntry[]> {
      return unwrap(
        await api.GET(`${P}/cost-codes/{costCodeId}/production/log`, {
          params: { path: { orgId, projectId, costCodeId } },
        }),
      ).data;
    },
    async logQuantity(projectId: string, costCodeId: string, body: LogQuantity) {
      return unwrap(
        await api.POST(`${P}/cost-codes/{costCodeId}/production/log`, {
          params: { path: { orgId, projectId, costCodeId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async exportLaborProductivity(
      projectId: string,
      filter: { divisionId?: string; subJobId?: string },
    ) {
      return unwrap(
        await api.GET(`${P}/reports/labor-productivity/export`, {
          params: { path: { orgId, projectId }, query: filter },
        }),
      );
    },
    async explainLabor(
      projectId: string,
      body: { costCodeId: string; question?: string; history?: LaborTurn[] },
    ): Promise<LaborExplanation> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/ai/labor-productivity`, {
          params: { path: { orgId, projectId } },
          body,
        }),
      );
    },
    async directCosts(projectId: string): Promise<DirectCostList> {
      return unwrap(await api.GET(`${P}/direct-costs`, { params: { path: { orgId, projectId } } }));
    },
    async recordDirectCost(projectId: string, body: RecordDirectCost): Promise<DirectCost> {
      return unwrap(
        await api.POST(`${P}/direct-costs`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async voidDirectCost(
      projectId: string,
      directCostId: string,
      note: string,
    ): Promise<DirectCost> {
      return unwrap(
        await api.POST(`${P}/direct-costs/{directCostId}/void`, {
          params: { path: { orgId, projectId, directCostId }, header: idempotencyKey() },
          body: { note },
        }),
      );
    },
    async importLines(projectId: string, body: ImportBudgetLinesRequest) {
      return unwrap(
        await api.POST(`${P}/budget/lines/import`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async snapshots(projectId: string): Promise<BudgetSnapshot[]> {
      return unwrap(
        await api.GET(`${P}/budget/snapshots`, { params: { path: { orgId, projectId } } }),
      ).data;
    },
    async createSnapshot(
      projectId: string,
      body: { name: string; note?: string },
    ): Promise<BudgetSnapshot> {
      return unwrap(
        await api.POST(`${P}/budget/snapshots`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
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
