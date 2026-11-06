import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type {
  BudgetAdjustmentRow,
  BudgetLineView,
  BudgetRow,
  BudgetSnapshotRow,
  BudgetService,
  CostCodeRow,
} from '../application/budget';
import { fromCents, isMoney } from '../domain/money';
import { isSignedMoney, revisedOf, snapshotTotals, totalsOf } from '../domain/budget';

const ref = (kind: IdKind, value: string, path: string) => {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
};
const project = (p: { projectId: string }) => {
  const id = decodeId('project', p.projectId);
  if (!id) throw new AppError('project.not_found');
  return id;
};
const money = (value: string, path: string) => {
  if (!isMoney(value))
    throw new AppError('validation_failed', 'Invalid amount', [
      { path, message: 'Invalid amount' },
    ]);
  return value;
};

const toCostCodeDto = (c: CostCodeRow) => ({
  id: encodeId('costCode', c.id),
  code: c.code,
  description: c.description,
  parentId: c.parentId ? encodeId('costCode', c.parentId) : null,
  archived: c.archived,
});

const toLineDto = (v: BudgetLineView) => ({
  id: encodeId('budgetLine', v.line.id),
  costCodeId: encodeId('costCode', v.line.costCodeId),
  code: v.code,
  codeDescription: v.codeDescription,
  description: v.line.description,
  original: v.line.original,
  approvedChanges: v.line.approvedChanges,
  revised: revisedOf(v.line),
  committed: v.line.committed,
  actual: v.line.actual,
  forecastToComplete: v.line.forecastToComplete,
  isMargin: v.line.isMargin,
});

const toBudgetDto = (b: { budget: BudgetRow | null; lines: BudgetLineView[] }) => ({
  id: b.budget ? encodeId('budget', b.budget.id) : null,
  status: b.budget?.status ?? ('draft' as const),
  lockedAt: b.budget?.lockedAt?.toISOString() ?? null,
  lines: b.lines.map(toLineDto),
  totals: totalsOf(b.lines.map((l) => l.line)),
});

const toAdjustmentDto = (a: BudgetAdjustmentRow) => ({
  id: encodeId('budgetAdjustment', a.id),
  amount: a.amount,
  reason: a.reason,
  createdAt: a.createdAt.toISOString(),
});

const toSnapshotDto = (r: BudgetSnapshotRow) => ({
  id: encodeId('budgetSnapshot', r.id),
  name: r.name,
  note: r.note,
  takenAt: r.takenAt.toISOString(),
  lines: r.lines.map((l) => ({
    costCodeId: encodeId('costCode', l.costCodeId),
    code: l.code,
    codeDescription: l.codeDescription,
    description: l.description,
    original: l.original,
    approvedChanges: l.approvedChanges,
    revised: l.revised,
    isMargin: l.isMargin,
  })),
  totals: snapshotTotals(r.lines),
});

export function budgetRoutes(database: Database, budget: BudgetService) {
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    database.withTenantTx(requireTenant(input), fn, { readOnly: true });
  const line = (p: { lineId: string }) => ref('budgetLine', p.lineId, 'lineId');

  return defineRoutes({
    listCostCodes: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => budget.listCostCodes(s, project(input.params)))).map(
          toCostCodeDto,
        ),
      },
    }),
    createCostCode: async (input) => ({
      status: 201,
      body: toCostCodeDto(
        await tx(input, (s) =>
          budget.createCostCode(s, project(input.params), {
            code: input.body.code,
            description: input.body.description,
            ...(input.body.parentId
              ? { parentId: ref('costCode', input.body.parentId, 'parentId') }
              : {}),
          }),
        ),
      ),
    }),
    updateCostCode: async (input) => ({
      status: 200,
      body: toCostCodeDto(
        await tx(input, (s) =>
          budget.updateCostCode(
            s,
            project(input.params),
            ref('costCode', input.params.costCodeId, 'costCodeId'),
            {
              ...(input.body.description !== undefined
                ? { description: input.body.description }
                : {}),
              ...(input.body.archived !== undefined ? { archived: input.body.archived } : {}),
            },
          ),
        ),
      ),
    }),
    getBudget: async (input) => ({
      status: 200,
      body: toBudgetDto(await read(input, (s) => budget.getBudget(s, project(input.params)))),
    }),
    createBudget: async (input) => ({
      status: 201,
      body: toBudgetDto(await tx(input, (s) => budget.createBudget(s, project(input.params)))),
    }),
    addBudgetLine: async (input) => ({
      status: 201,
      body: toLineDto(
        await tx(input, (s) =>
          budget.addLine(s, project(input.params), {
            costCodeId: ref('costCode', input.body.costCodeId, 'costCodeId'),
            original: money(input.body.original, 'original'),
            ...(input.body.description !== undefined
              ? { description: input.body.description }
              : {}),
            ...(input.body.isMargin !== undefined ? { isMargin: input.body.isMargin } : {}),
          }),
        ),
      ),
    }),
    updateBudgetLine: async (input) => ({
      status: 200,
      body: toLineDto(
        await tx(input, (s) =>
          budget.updateLine(s, project(input.params), line(input.params), {
            ...(input.body.description !== undefined
              ? { description: input.body.description }
              : {}),
            ...(input.body.original !== undefined
              ? { original: money(input.body.original, 'original') }
              : {}),
            ...(input.body.isMargin !== undefined ? { isMargin: input.body.isMargin } : {}),
          }),
        ),
      ),
    }),
    deleteBudgetLine: async (input) => {
      await tx(input, (s) => budget.deleteLine(s, project(input.params), line(input.params)));
      return { status: 204 };
    },
    lockBudget: async (input) => ({
      status: 200,
      body: toBudgetDto(await tx(input, (s) => budget.lockBudget(s, project(input.params)))),
    }),
    adjustBudgetLine: async (input) => {
      if (!isSignedMoney(input.body.amount))
        throw new AppError('validation_failed', 'Invalid amount', [
          { path: 'amount', message: 'Invalid amount' },
        ]);
      return {
        status: 201,
        body: toLineDto(
          await tx(input, (s) =>
            budget.adjustLine(s, project(input.params), line(input.params), input.body),
          ),
        ),
      };
    },
    getBudgetVsForecast: async (input) => {
      const r = await read(input, (s) => budget.budgetVsForecastFor(s, project(input.params)));
      const row = (
        x: (typeof r.rows)[number],
        label?: { code: string | null; description: string },
      ) => ({
        costCodeId: x.costCodeId ? encodeId('costCode', x.costCodeId) : null,
        code: label ? label.code : (r.byId.get(x.costCodeId ?? '')?.code ?? null),
        codeDescription: label
          ? label.description
          : (r.byId.get(x.costCodeId ?? '')?.description ?? ''),
        revised: fromCents(x.revisedCents),
        committed: fromCents(x.committedCents),
        claimed: fromCents(x.claimedCents),
        adjustments: fromCents(x.adjustmentsCents),
        directCosts: fromCents(x.directCents),
        forecastFinal: fromCents(x.forecastFinalCents),
        variance: fromCents(x.varianceCents),
      });
      return {
        status: 200,
        body: {
          budgetStatus: r.budget?.status ?? null,
          rows: r.rows
            .map((x) => row(x))
            .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '')),
          unallocated: row(r.unallocated, { code: null, description: 'Not tagged to a cost code' }),
          totals: row(r.totals, { code: null, description: 'Total' }),
        },
      };
    },
    listBudgetSnapshots: async (input) => ({
      status: 200,
      body: {
        data: (await read(input, (s) => budget.listSnapshots(s, project(input.params)))).map(
          toSnapshotDto,
        ),
      },
    }),
    createBudgetSnapshot: async (input) => ({
      status: 201,
      body: toSnapshotDto(
        await tx(input, (s) =>
          budget.createSnapshot(s, project(input.params), {
            name: input.body.name,
            ...(input.body.note ? { note: input.body.note } : {}),
          }),
        ),
      ),
    }),
    getBudgetSnapshot: async (input) => ({
      status: 200,
      body: toSnapshotDto(
        await read(input, (s) =>
          budget.getSnapshot(
            s,
            project(input.params),
            ref('budgetSnapshot', input.params.snapshotId, 'snapshotId'),
          ),
        ),
      ),
    }),
    listBudgetAdjustments: async (input) => ({
      status: 200,
      body: {
        data: (
          await read(input, (s) =>
            budget.listAdjustments(s, project(input.params), line(input.params)),
          )
        ).map(toAdjustmentDto),
      },
    }),
  });
}
