import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, isMoney, toCents } from '../domain/money';
import {
  budgetVsForecast,
  type BvfAdjustment,
  type BvfDirect,
  type BvfSub,
} from '../domain/budget-vs-forecast';
import { budgetFindings } from '../domain/budget-review';
import { revisedOf, signedCents, totalsOf, isSignedMoney } from '../domain/budget';
import {
  budgetAdjustments,
  budgetForecastEntries,
  budgetLines,
  budgetSnapshots,
  budgets,
  commitmentLines,
  commitments,
  costCodes,
  directCosts,
} from '../infra/tables';

export type CostCodeRow = typeof costCodes.$inferSelect;
export type BudgetRow = typeof budgets.$inferSelect;
export type BudgetLineRow = typeof budgetLines.$inferSelect;
export type BudgetAdjustmentRow = typeof budgetAdjustments.$inferSelect;
export type BudgetSnapshotRow = typeof budgetSnapshots.$inferSelect;

export interface ForecastInputs {
  subs: BvfSub[];
  adjustments: BvfAdjustment[];
  direct: BvfDirect[];
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

const NO_BUDGET = {
  restricted: false,
  hasBudget: false,
  revisedCents: 0,
  forecastFinalCents: 0,
  spentCents: 0,
  varianceCents: 0,
  overBudgetCodes: 0,
};

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

  const MAX_IMPORT_ROWS = 500;

  /**
   * Fills a draft budget from a spreadsheet's rows, all or nothing. A row names a cost code; a code that does not exist
   * yet is created when the row gives its description. Every problem across the file is reported together, so the
   * person fixes the sheet once rather than one row per attempt.
   */
  async function importLines(
    scope: TenantScope,
    projectId: string,
    rows: {
      code: string;
      codeDescription?: string;
      description?: string;
      original: string;
      isMargin?: boolean;
    }[],
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const budget = await writableDraft(scope, projectId);
    if (rows.length === 0)
      throw new AppError('validation_failed', 'The file has no rows.', [
        { path: 'rows', message: 'Add at least one row' },
      ]);
    if (rows.length > MAX_IMPORT_ROWS)
      throw new AppError('validation_failed', `Import at most ${MAX_IMPORT_ROWS} rows at a time.`, [
        { path: 'rows', message: `Too many rows (maximum ${MAX_IMPORT_ROWS})` },
      ]);
    const existing = new Map(
      (await scope.tx.select().from(costCodes).where(eq(costCodes.projectId, projectId))).map(
        (c) => [c.code, c] as const,
      ),
    );
    const budgeted = new Set(
      (
        await scope.tx
          .select({ id: budgetLines.costCodeId })
          .from(budgetLines)
          .where(eq(budgetLines.budgetId, budget.id))
      ).map((l) => l.id),
    );
    const errors: { path: string; message: string }[] = [];
    const seen = new Set<string>();
    rows.forEach((r, i) => {
      const at = (field: string, message: string) =>
        errors.push({ path: `rows[${i}].${field}`, message });
      const code = r.code.trim();
      if (!code || code.length > 30) at('code', 'Give a cost code of up to 30 characters');
      else if (seen.has(code)) at('code', `${code} appears more than once`);
      seen.add(code);
      if (!isMoney(r.original.trim())) at('original', 'Enter a dollar amount like 12500.00');
      const known = existing.get(code);
      if (known?.archived) at('code', `${code} is archived`);
      else if (known && budgeted.has(known.id)) at('code', `${code} already has a budget line`);
      else if (!known && code && !r.codeDescription?.trim())
        at('codeDescription', `${code} is new: give its description`);
      if ((r.codeDescription?.trim().length ?? 0) > 200)
        at('codeDescription', 'At most 200 characters');
      if ((r.description?.trim().length ?? 0) > 300) at('description', 'At most 300 characters');
    });
    if (errors.length > 0)
      throw new AppError(
        'validation_failed',
        `${errors.length} problem${errors.length === 1 ? '' : 's'} in the file. Nothing was imported.`,
        errors.slice(0, 50),
      );
    for (const r of rows) {
      const code = r.code.trim();
      const costCode =
        existing.get(code) ??
        (await createCostCode(scope, projectId, { code, description: r.codeDescription!.trim() }));
      await addLine(scope, projectId, {
        costCodeId: costCode.id,
        original: r.original.trim(),
        ...(r.description?.trim() ? { description: r.description.trim() } : {}),
        ...(r.isMargin ? { isMargin: true } : {}),
      });
    }
    const showMargin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    return { budget, lines: await viewLines(scope, budget.id, showMargin), imported: rows.length };
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

  /** Every revision on the project, newest first, with the cost code each belongs to. Margin lines need the margin permission. */
  async function listProjectAdjustments(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    const margin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    const rows = await scope.tx
      .select({
        adjustment: budgetAdjustments,
        code: costCodes.code,
        codeDescription: costCodes.description,
        isMargin: budgetLines.isMargin,
      })
      .from(budgetAdjustments)
      .innerJoin(budgetLines, eq(budgetLines.id, budgetAdjustments.budgetLineId))
      .innerJoin(costCodes, eq(costCodes.id, budgetLines.costCodeId))
      .where(eq(budgetAdjustments.projectId, projectId))
      .orderBy(desc(budgetAdjustments.createdAt), desc(budgetAdjustments.id));
    return rows.filter((r) => margin || !r.isMargin);
  }

  // ---- Snapshots ----------------------------------------------------------------------------------------------

  /** Margin lines are hidden from readers without the margin permission, in snapshots as in the live budget. */
  async function visibleSnapshot(scope: TenantScope, projectId: string, row: BudgetSnapshotRow) {
    const margin = await deps.access.can(scope, 'financials.budget.view_margin', { projectId });
    return { ...row, lines: row.lines.filter((l) => margin || !l.isMargin) };
  }

  async function createSnapshot(
    scope: TenantScope,
    projectId: string,
    input: { name: string; note?: string },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const name = input.name.trim();
    if (!name)
      throw new AppError('validation_failed', 'Give the snapshot a name.', [
        { path: 'name', message: 'Required' },
      ]);
    const budget = await budgetFor(scope, projectId, true);
    if (!budget) throw new AppError('financials.budget.not_found', 'Start the budget first.');
    // Take every line, margin included, so a reader with the margin permission sees it all later.
    const lines = (await viewLines(scope, budget.id, true)).map((v) => ({
      costCodeId: v.line.costCodeId,
      code: v.code,
      codeDescription: v.codeDescription,
      description: v.line.description,
      original: v.line.original,
      approvedChanges: v.line.approvedChanges,
      revised: revisedOf(v.line),
      isMargin: v.line.isMargin,
    }));
    const [row] = await scope.tx
      .insert(budgetSnapshots)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        budgetId: budget.id,
        name,
        note: input.note?.trim() || null,
        lines,
        takenAt: now(),
        takenBy: scope.ctx.userId,
      })
      .returning();
    return visibleSnapshot(scope, projectId, row!);
  }

  async function listSnapshots(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(budgetSnapshots)
      .where(eq(budgetSnapshots.projectId, projectId))
      .orderBy(desc(budgetSnapshots.takenAt), desc(budgetSnapshots.id));
    return Promise.all(rows.map((r) => visibleSnapshot(scope, projectId, r)));
  }

  async function getSnapshot(scope: TenantScope, projectId: string, snapshotId: string) {
    await need(scope, 'financials.budget.read', projectId);
    await requireStaff(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(budgetSnapshots)
      .where(and(eq(budgetSnapshots.id, snapshotId), eq(budgetSnapshots.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('financials.budget.snapshot_not_found');
    return visibleSnapshot(scope, projectId, row);
  }

  /**
   * What Nova and the checks panel work from: the code-found findings and the totals they sit in. Margin never
   * appears, even for a caller who may see it elsewhere, because it would otherwise reach a prompt and an answer.
   */
  async function reviewFacts(scope: TenantScope, projectId: string) {
    const { budget, lines } = await getBudget(scope, projectId);
    const shown = lines.filter((l) => !l.line.isMargin);
    const sum = (pick: (l: BudgetLineRow) => string) =>
      fromCents(shown.reduce((n, l) => n + signedCents(pick(l.line)), 0));
    return {
      hasBudget: budget !== null,
      status: budget?.status ?? ('draft' as const),
      lineCount: shown.length,
      totals: {
        revised: fromCents(shown.reduce((n, l) => n + signedCents(revisedOf(l.line)), 0)),
        committed: sum((l) => l.committed),
        actual: sum((l) => l.actual),
      },
      findings: budgetFindings(
        shown.map((l) => ({
          id: l.line.id,
          code: l.code,
          codeDescription: l.codeDescription,
          original: l.line.original,
          approvedChanges: l.line.approvedChanges,
          committed: l.line.committed,
          actual: l.line.actual,
          isMargin: false,
        })),
      ),
    };
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
      inputs.direct,
    );
    return { budget, ...r, byId };
  }

  /**
   * One line per project for the portfolio dashboard (`reporting`): revised budget, forecast final cost and the
   * variance between them. Needs the same permissions as the budget-vs-forecast screen and staff only; anything less
   * reads as `restricted` with no figures. Margin lines are left out unless the caller may see them, exactly as on
   * that screen, so the totals cannot be used to work a hidden amount out.
   */
  async function portfolioSummary(scope: TenantScope, projectId: string) {
    const ok =
      scope.ctx.principalType === 'member' &&
      (await deps.access.can(scope, 'financials.budget.read', { projectId })) &&
      (await deps.access.can(scope, 'financials.forecast.read', { projectId }));
    if (!ok) return { ...NO_BUDGET, restricted: true };
    const r = await budgetVsForecastFor(scope, projectId);
    if (!r.budget) return NO_BUDGET;
    return {
      restricted: false,
      hasBudget: true,
      revisedCents: r.totals.revisedCents,
      forecastFinalCents: r.totals.forecastFinalCents,
      spentCents: r.totals.claimedCents + r.totals.directCents,
      varianceCents: r.totals.varianceCents,
      overBudgetCodes: r.rows.filter((x) => x.varianceCents < 0).length,
    };
  }

  /**
   * The cost report: every visible budget line with what is approved, what is waiting for approval and what has been
   * spent without a commitment, and the projected cost those add up to. Pending is the lines of submitted commitments.
   * Margin lines follow the same rule as the budget itself.
   */
  async function costReport(scope: TenantScope, projectId: string) {
    const { budget, lines } = await getBudget(scope, projectId);
    if (!budget) return { hasBudget: false, status: 'draft' as const, lines: [] };
    const pendingRows = await scope.tx
      .select({ lineId: commitmentLines.budgetLineId, amount: commitmentLines.amount })
      .from(commitmentLines)
      .innerJoin(commitments, eq(commitments.id, commitmentLines.commitmentId))
      .where(and(eq(commitments.projectId, projectId), eq(commitments.status, 'submitted')));
    const pending = new Map<string, number>();
    for (const r of pendingRows)
      pending.set(r.lineId, (pending.get(r.lineId) ?? 0) + signedCents(r.amount));
    return {
      hasBudget: true,
      status: budget.status,
      lines: lines.map((l) => {
        const revised = signedCents(revisedOf(l.line));
        const approved = signedCents(l.line.committed);
        const pend = pending.get(l.line.id) ?? 0;
        const nonCommitted = signedCents(l.line.actual);
        const projected = approved + pend + nonCommitted;
        return {
          line: l.line,
          code: l.code,
          codeDescription: l.codeDescription,
          original: l.line.original,
          approvedChanges: l.line.approvedChanges,
          revised: fromCents(revised),
          approved: fromCents(approved),
          pending: fromCents(pend),
          nonCommitted: fromCents(nonCommitted),
          projected: fromCents(projected),
          variance: fromCents(revised - projected),
        };
      }),
    };
  }

  /** The source items behind one figure on the cost report, grouped under the contract or order they came from. */
  async function costReportItems(
    scope: TenantScope,
    projectId: string,
    lineId: string,
    column: 'approved' | 'pending' | 'direct',
  ) {
    const { lines } = await getBudget(scope, projectId);
    const view = lines.find((l) => l.line.id === lineId);
    if (!view) throw new AppError('financials.budget.line_not_found');
    const code = `${view.code} - ${view.codeDescription}`;
    if (column === 'direct') {
      const rows = await scope.tx
        .select()
        .from(directCosts)
        .where(
          and(
            eq(directCosts.projectId, projectId),
            eq(directCosts.budgetLineId, lineId),
            eq(directCosts.status, 'recorded'),
          ),
        )
        .orderBy(asc(directCosts.number));
      const total = rows.reduce((n, r) => n + signedCents(r.amount), 0);
      return {
        code,
        total: fromCents(total),
        groups: rows.length
          ? [
              {
                kind: 'direct_costs' as const,
                sourceId: null as string | null,
                label: 'Direct costs',
                total: fromCents(total),
                items: rows.map((r) => ({
                  number: r.number,
                  description: r.description,
                  amount: r.amount,
                })),
              },
            ]
          : [],
      };
    }
    const rows = await scope.tx
      .select({ c: commitments, l: commitmentLines })
      .from(commitmentLines)
      .innerJoin(commitments, eq(commitments.id, commitmentLines.commitmentId))
      .where(
        and(
          eq(commitments.projectId, projectId),
          eq(commitmentLines.budgetLineId, lineId),
          eq(commitments.status, column === 'approved' ? 'approved' : 'submitted'),
        ),
      )
      .orderBy(asc(commitments.number), asc(commitmentLines.sort));
    const groups = new Map<
      string,
      {
        kind: 'subcontract' | 'purchase_order';
        sourceId: string | null;
        label: string;
        cents: number;
        items: { number: number; description: string; amount: string }[];
      }
    >();
    for (const { c, l } of rows) {
      let g = groups.get(c.id);
      if (!g) {
        g = {
          kind: c.kind,
          sourceId: c.id,
          label: `${c.kind === 'subcontract' ? 'SC' : 'PO'}-${c.number} - ${c.title}`,
          cents: 0,
          items: [],
        };
        groups.set(c.id, g);
      }
      g.cents += signedCents(l.amount);
      g.items.push({ number: g.items.length + 1, description: l.description, amount: l.amount });
    }
    const list = [...groups.values()];
    return {
      code,
      total: fromCents(list.reduce((n, g) => n + g.cents, 0)),
      groups: list.map(({ cents, ...g }) => ({ ...g, total: fromCents(cents) })),
    };
  }

  const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
  const MAX_FORECAST_ENTRIES = 1200;

  /** Monthly spend forecast per budget line, beside what each line is projected to cost. */
  async function forecast(scope: TenantScope, projectId: string) {
    const report = await costReport(scope, projectId);
    if (!report.hasBudget) return { hasBudget: false, months: [] as string[], lines: [] };
    const rows = await scope.tx
      .select()
      .from(budgetForecastEntries)
      .where(eq(budgetForecastEntries.projectId, projectId));
    const byLine = new Map<string, Record<string, string>>();
    for (const r of rows) {
      const m = r.month.slice(0, 7);
      byLine.set(r.budgetLineId, { ...(byLine.get(r.budgetLineId) ?? {}), [m]: r.amount });
    }
    const visible = new Set(report.lines.map((l) => l.line.id));
    const months = [
      ...new Set(rows.filter((r) => visible.has(r.budgetLineId)).map((r) => r.month.slice(0, 7))),
    ].sort();
    return {
      hasBudget: true,
      months,
      lines: report.lines.map((l) => {
        const entries = byLine.get(l.line.id) ?? {};
        const scheduled = Object.values(entries).reduce((n, v) => n + signedCents(v), 0);
        return {
          ...l,
          entries,
          scheduled: fromCents(scheduled),
          unscheduled: fromCents(signedCents(l.projected) - scheduled),
        };
      }),
    };
  }

  /** Replaces the monthly forecast of each named line. Months are `YYYY-MM`, amounts are not negative. */
  async function saveForecast(
    scope: TenantScope,
    projectId: string,
    input: { lines: { lineId: string; entries: Record<string, string> }[] },
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    await requireStaff(scope, projectId);
    const { lines } = await getBudget(scope, projectId);
    const visible = new Set(lines.map((l) => l.line.id));
    let count = 0;
    const seen = new Set<string>();
    for (const [i, l] of input.lines.entries()) {
      if (!visible.has(l.lineId)) throw new AppError('financials.budget.line_not_found');
      if (seen.has(l.lineId))
        throw new AppError('validation_failed', 'A line appears twice.', [
          { path: `lines.${i}.lineId`, message: 'Duplicate line' },
        ]);
      seen.add(l.lineId);
      for (const [m, v] of Object.entries(l.entries)) {
        count++;
        if (!MONTH.test(m) || !isMoney(v))
          throw new AppError(
            'validation_failed',
            'Use a month like 2026-11 and an amount of zero or more.',
            [{ path: `lines.${i}.entries.${m}`, message: 'Invalid month or amount' }],
          );
      }
    }
    if (count > MAX_FORECAST_ENTRIES)
      throw new AppError('validation_failed', 'Too many months in one save.', [
        { path: 'lines', message: `At most ${MAX_FORECAST_ENTRIES} entries` },
      ]);
    for (const l of input.lines) {
      await scope.tx
        .delete(budgetForecastEntries)
        .where(
          and(
            eq(budgetForecastEntries.projectId, projectId),
            eq(budgetForecastEntries.budgetLineId, l.lineId),
          ),
        );
      const values = Object.entries(l.entries)
        .filter(([, v]) => toCents(v) > 0)
        .map(([m, v]) => ({
          id: uuidv7(),
          orgId: scope.ctx.orgId,
          projectId,
          budgetLineId: l.lineId,
          month: `${m}-01`,
          amount: v,
          updatedBy: scope.ctx.userId,
        }));
      if (values.length) await scope.tx.insert(budgetForecastEntries).values(values);
    }
    return forecast(scope, projectId);
  }

  return {
    forecast,
    saveForecast,
    costReport,
    costReportItems,
    budgetVsForecastFor,
    reviewFacts,
    portfolioSummary,
    listCostCodes,
    createCostCode,
    updateCostCode,
    getBudget,
    createBudget,
    addLine,
    updateLine,
    deleteLine,
    lockBudget,
    importLines,
    adjustLine,
    listAdjustments,
    listProjectAdjustments,
    createSnapshot,
    listSnapshots,
    getSnapshot,
  };
}

export type BudgetService = ReturnType<typeof createBudgetService>;
export { revisedOf, totalsOf };
