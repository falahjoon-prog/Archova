import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, toCents } from '../domain/money';
import { budgetVsForecast, type BvfAdjustment, type BvfSub } from '../domain/budget-vs-forecast';
import { revisedOf, signedCents, totalsOf, isSignedMoney } from '../domain/budget';
import { budgetAdjustments, budgetLines, budgets, costCodes } from '../infra/tables';

export type CostCodeRow = typeof costCodes.$inferSelect;
export type BudgetRow = typeof budgets.$inferSelect;
export type BudgetLineRow = typeof budgetLines.$inferSelect;
export type BudgetAdjustmentRow = typeof budgetAdjustments.$inferSelect;

export interface ForecastInputs {
  subs: BvfSub[];
  adjustments: BvfAdjustment[];
}

export interface BudgetDeps {
  access: AccessService;
  now?: () => Date;
}

export interface BudgetLineView {
  line: BudgetLineRow;
  code: string;
  codeDescription: string;
}

export function createBudgetService(
  deps: BudgetDeps & {
    /** Forecast inputs for the budget comparison; the forecast service owns how they're read. */
    forecastInputs?: (scope: TenantScope, projectId: string) => Promise<ForecastInputs>;
  },
) {
  const now = deps.now ?? (() => new Date());
  const need = (scope: TenantScope, key: string, projectId: string) =>
    deps.access.assert(scope, key, { projectId });

  /** Budgets are the builder's cost position: outsiders (clients, subcontractors) never see them whatever template. */
  async function requireStaff(scope: TenantScope, _projectId: string) {
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can use the budget.");
  }

  // ---- Cost codes ---------------------------------------------------------------------------------------------

  async function listCostCodes(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    return scope.tx
      .select()
      .from(costCodes)
      .where(eq(costCodes.projectId, projectId))
      .orderBy(asc(costCodes.code));
  }

  async function costCodeRow(scope: TenantScope, projectId: string, id: string) {
    const [row] = await scope.tx
      .select()
      .from(costCodes)
      .where(and(eq(costCodes.id, id), eq(costCodes.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('financials.cost_code.not_found');
    return row;
  }

  async function createCostCode(
    scope: TenantScope,
    projectId: string,
    input: { code: string; description: string; parentId?: string },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const code = input.code.trim();
    if (!code)
      throw new AppError('validation_failed', 'Give the cost code.', [
        { path: 'code', message: 'Required' },
      ]);
    if (input.parentId) await costCodeRow(scope, projectId, input.parentId);
    const [dup] = await scope.tx
      .select({ id: costCodes.id })
      .from(costCodes)
      .where(and(eq(costCodes.projectId, projectId), eq(costCodes.code, code)))
      .limit(1);
    if (dup)
      throw new AppError('financials.cost_code.duplicate', `Cost code ${code} already exists.`);
    const [row] = await scope.tx
      .insert(costCodes)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        code,
        description: input.description.trim(),
        parentId: input.parentId ?? null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function updateCostCode(
    scope: TenantScope,
    projectId: string,
    id: string,
    patch: { description?: string; archived?: boolean },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    await costCodeRow(scope, projectId, id);
    const set = {
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived } : {}),
    };
    if (Object.keys(set).length === 0) return costCodeRow(scope, projectId, id);
    const [row] = await scope.tx.update(costCodes).set(set).where(eq(costCodes.id, id)).returning();
    return row!;
  }

  // ---- Budget -------------------------------------------------------------------------------------------------

  /** Locks the budget row so line edits, locking and adjustments for one project run one at a time. */
  async function budgetFor(scope: TenantScope, projectId: string, forUpdate = false) {
    const q = scope.tx.select().from(budgets).where(eq(budgets.projectId, projectId)).limit(1);
    const [row] = await (forUpdate ? q.for('update') : q);
    return row ?? null;
  }

  async function viewLines(scope: TenantScope, budgetId: string, showMargin: boolean) {
    const rows = await scope.tx
      .select({ line: budgetLines, code: costCodes.code, codeDescription: costCodes.description })
      .from(budgetLines)
      .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
      .where(eq(budgetLines.budgetId, budgetId))
      .orderBy(asc(budgetLines.sort), asc(costCodes.code));
    // Margin lines are the builder's own take: without the margin permission they, and their share of the totals,
    // are left out entirely so the totals can't be subtracted to reveal them.
    return rows.filter((r) => showMargin || !r.line.isMargin);
  }

  async function getBudget(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    const budget = await budgetFor(scope, projectId);
    if (!budget) return { budget: null, lines: [] as BudgetLineView[] };
    const showMargin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    return { budget, lines: await viewLines(scope, budget.id, showMargin) };
  }

  async function createBudget(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    // unique (project_id) makes a concurrent second create fail rather than make two budgets.
    const [row] = await scope.tx
      .insert(budgets)
      .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, createdBy: scope.ctx.userId })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('financials.budget.exists', 'This project already has a budget.');
    return { budget: row, lines: [] as BudgetLineView[] };
  }

  async function writableDraft(scope: TenantScope, projectId: string) {
    const budget = await budgetFor(scope, projectId, true);
    if (!budget) throw new AppError('financials.budget.not_found', 'Start the budget first.');
    if (budget.status !== 'draft')
      throw new AppError(
        'financials.budget.locked',
        'The budget is locked. Use an adjustment to change a line.',
      );
    return budget;
  }

  async function lineRow(scope: TenantScope, projectId: string, lineId: string) {
    const [row] = await scope.tx
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.id, lineId), eq(budgetLines.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('financials.budget.line_not_found');
    return row;
  }

  async function view(scope: TenantScope, projectId: string, line: BudgetLineRow) {
    const [c] = await scope.tx
      .select({ code: costCodes.code, codeDescription: costCodes.description })
      .from(costCodes)
      .where(eq(costCodes.id, line.costCodeId));
    return { line, code: c!.code, codeDescription: c!.codeDescription };
  }

  async function addLine(
    scope: TenantScope,
    projectId: string,
    input: { costCodeId: string; description?: string; original: string; isMargin?: boolean },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const budget = await writableDraft(scope, projectId);
    const code = await costCodeRow(scope, projectId, input.costCodeId);
    if (code.archived)
      throw new AppError('validation_failed', `Cost code ${code.code} is archived.`, [
        { path: 'costCodeId', message: 'Archived' },
      ]);
    const [dup] = await scope.tx
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.costCodeId, input.costCodeId)))
      .limit(1);
    if (dup)
      throw new AppError(
        'financials.budget.duplicate_line',
        `Cost code ${code.code} already has a budget line.`,
      );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${budgetLines.sort}), -1) + 1` })
      .from(budgetLines)
      .where(eq(budgetLines.budgetId, budget.id));
    const [row] = await scope.tx
      .insert(budgetLines)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        budgetId: budget.id,
        costCodeId: input.costCodeId,
        description: input.description?.trim() ?? '',
        original: input.original,
        isMargin: input.isMargin ?? false,
        sort: Number(n!.n),
      })
      .returning();
    return view(scope, projectId, row!);
  }

  async function updateLine(
    scope: TenantScope,
    projectId: string,
    lineId: string,
    patch: { description?: string; original?: string; isMargin?: boolean },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    await writableDraft(scope, projectId);
    const existing = await lineRow(scope, projectId, lineId);
    const set = {
      ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
      ...(patch.original !== undefined ? { original: patch.original } : {}),
      ...(patch.isMargin !== undefined ? { isMargin: patch.isMargin } : {}),
    };
    if (Object.keys(set).length === 0) return view(scope, projectId, existing);
    const [row] = await scope.tx
      .update(budgetLines)
      .set(set)
      .where(eq(budgetLines.id, lineId))
      .returning();
    return view(scope, projectId, row!);
  }

  async function deleteLine(scope: TenantScope, projectId: string, lineId: string) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    await writableDraft(scope, projectId);
    await lineRow(scope, projectId, lineId);
    await scope.tx.delete(budgetLines).where(eq(budgetLines.id, lineId));
  }

  async function lockBudget(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const budget = await writableDraft(scope, projectId);
    const [row] = await scope.tx
      .update(budgets)
      .set({ status: 'locked', lockedAt: now(), lockedBy: scope.ctx.userId })
      .where(eq(budgets.id, budget.id))
      .returning();
    const showMargin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    return { budget: row!, lines: await viewLines(scope, budget.id, showMargin) };
  }

  async function adjustLine(
    scope: TenantScope,
    projectId: string,
    lineId: string,
    input: { amount: string; reason: string },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const budget = await budgetFor(scope, projectId, true);
    if (!budget) throw new AppError('financials.budget.not_found', 'Start the budget first.');
    if (budget.status !== 'locked')
      throw new AppError(
        'financials.budget.not_locked',
        'The budget is still a draft. Edit the line directly.',
      );
    if (!isSignedMoney(input.amount) || signedCents(input.amount) === 0)
      throw new AppError('validation_failed', 'Give an amount other than zero.', [
        { path: 'amount', message: 'Must not be zero' },
      ]);
    const reason = input.reason.trim();
    if (!reason)
      throw new AppError('validation_failed', 'Give the reason for the change.', [
        { path: 'reason', message: 'Required' },
      ]);
    const line = await lineRow(scope, projectId, lineId);
    const next = signedCents(line.approvedChanges) + signedCents(input.amount);
    if (toCents(line.original) + next < 0)
      throw new AppError(
        'financials.budget.below_zero',
        'That change would take the line below zero.',
        [{ path: 'amount', message: 'Revised budget can not be negative' }],
      );
    await scope.tx.insert(budgetAdjustments).values({
      id: uuidv7(),
      orgId: scope.ctx.orgId,
      projectId,
      budgetLineId: lineId,
      amount: input.amount,
      reason,
      createdBy: scope.ctx.userId,
    });
    const [row] = await scope.tx
      .update(budgetLines)
      .set({ approvedChanges: fromCents(next) })
      .where(eq(budgetLines.id, lineId))
      .returning();
    return view(scope, projectId, row!);
  }

  async function listAdjustments(scope: TenantScope, projectId: string, lineId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    const line = await lineRow(scope, projectId, lineId);
    const margin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    if (line.isMargin && !margin) throw new AppError('financials.budget.line_not_found');
    return scope.tx
      .select()
      .from(budgetAdjustments)
      .where(eq(budgetAdjustments.budgetLineId, lineId))
      .orderBy(asc(budgetAdjustments.createdAt), asc(budgetAdjustments.id));
  }

  async function budgetVsForecastFor(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.forecast.read', projectId);
    const { budget, lines } = await getBudget(scope, projectId);
    const showMargin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    const all = await scope.tx.select().from(costCodes).where(eq(costCodes.projectId, projectId));
    const byId = new Map(all.map((c) => [c.id, c]));
    const hidden = new Set<string>();
    if (budget && !showMargin) {
      const margin = await scope.tx
        .select({ costCodeId: budgetLines.costCodeId })
        .from(budgetLines)
        .where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.isMargin, true)));
      for (const m of margin) hidden.add(m.costCodeId);
    }
    const inputs = await deps.forecastInputs!(scope, projectId);
    const r = budgetVsForecast(
      lines.map((l) => ({
        costCodeId: l.line.costCodeId,
        code: l.code,
        description: l.codeDescription,
        revisedCents: signedCents(revisedOf(l.line)),
      })),
      inputs.subs,
      inputs.adjustments,
      hidden,
    );
    return { budget, ...r, byId };
  }

  return {
    budgetVsForecastFor,
    listCostCodes,
    createCostCode,
    updateCostCode,
    getBudget,
    createBudget,
    addLine,
    updateLine,
    deleteLine,
    lockBudget,
    adjustLine,
    listAdjustments,
  };
}

export type BudgetService = ReturnType<typeof createBudgetService>;
export { revisedOf, totalsOf };
