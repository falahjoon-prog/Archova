import { and, desc, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import {
  laborProductivityCsv,
  divisionOf,
  isWithin,
  productivityRow,
  productivityTotals,
  type CodeNode,
  type Plan,
} from '../domain/productivity';
import { costCodeProduction, costCodes, productionLog } from '../infra/tables';

export interface ProductivityDeps {
  access: AccessService;
  /** Worked minutes per cost code on a project (workforce); `null` code means the line carries none. */
  timesheetMinutes: (
    scope: TenantScope,
    projectId: string,
  ) => Promise<{ costCodeId: string | null; minutes: number }[]>;
  now?: () => Date;
}

export interface ProductionInput {
  uom: string;
  budgetedHours: number;
  budgetedQuantity: number;
  /** Opening quantity in place; only set when the plan is created or corrected. Later progress is logged. */
  quantityComplete?: number;
}

export interface LogQuantityInput {
  /** yyyy-mm-dd, not in the future. */
  loggedOn: string;
  /** Quantity put in place since the last entry; negative to correct, which needs a note. */
  quantity: number;
  note?: string;
}

const num = (v: string) => Number(v);

/**
 * Labor productivity: timesheet hours against a per-cost-code production plan (budgeted hours and quantity, quantity
 * in place). Builder staff only, like the budget. Hours are read live from workforce, never copied.
 */
export function createProductivityService(deps: ProductivityDeps) {
  const now = deps.now ?? (() => new Date());
  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can use labor productivity.");
  };

  async function report(
    scope: TenantScope,
    projectId: string,
    filter: { divisionId?: string; subJobId?: string },
  ) {
    await need(scope, 'financials.budget.read', projectId);
    const codes = await scope.tx.select().from(costCodes).where(eq(costCodes.projectId, projectId));
    const nodes = new Map<string, CodeNode>(
      codes.map((c) => [
        c.id,
        { id: c.id, code: c.code, description: c.description, parentId: c.parentId },
      ]),
    );
    const plans = await scope.tx
      .select()
      .from(costCodeProduction)
      .where(eq(costCodeProduction.projectId, projectId));
    const planBy = new Map<string, Plan>(
      plans.map((p) => [
        p.costCodeId,
        {
          uom: p.uom,
          budgetedHours: num(p.budgetedHours),
          budgetedQuantity: num(p.budgetedQuantity),
          quantityComplete: num(p.quantityComplete),
        },
      ]),
    );
    const minutes = await deps.timesheetMinutes(scope, projectId);
    const minutesBy = new Map<string, number>();
    let unallocatedMinutes = 0;
    for (const m of minutes) {
      if (m.costCodeId && nodes.has(m.costCodeId)) minutesBy.set(m.costCodeId, m.minutes);
      else unallocatedMinutes += m.minutes;
    }
    for (const id of [filter.divisionId, filter.subJobId])
      if (id && !nodes.has(id)) throw new AppError('financials.cost_code.not_found');

    const rows = [...nodes.values()]
      .filter((n) => planBy.has(n.id) || (minutesBy.get(n.id) ?? 0) > 0)
      .map((n) => ({ n, division: divisionOf(nodes, n.id) }))
      .filter(({ n, division }) => {
        if (filter.divisionId && division !== filter.divisionId) return false;
        if (filter.subJobId && !isWithin(nodes, n.id, filter.subJobId)) return false;
        return true;
      })
      .map(({ n, division }) =>
        productivityRow(n, division, planBy.get(n.id) ?? null, minutesBy.get(n.id) ?? 0),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      rows,
      totals: productivityTotals(rows),
      unallocatedHours: Math.round((unallocatedMinutes / 60) * 100) / 100,
      codes: [...nodes.values()].sort((a, b) => a.code.localeCompare(b.code)),
    };
  }

  async function setProduction(
    scope: TenantScope,
    projectId: string,
    costCodeId: string,
    input: ProductionInput,
  ) {
    await need(scope, 'financials.budget.manage', projectId);
    const [code] = await scope.tx
      .select({ id: costCodes.id })
      .from(costCodes)
      .where(and(eq(costCodes.id, costCodeId), eq(costCodes.projectId, projectId)))
      .limit(1);
    if (!code) throw new AppError('financials.cost_code.not_found');
    const uom = input.uom.trim();
    if (!uom)
      throw new AppError('validation_failed', 'Enter a unit of measure.', [
        { path: 'uom', message: 'Required' },
      ]);
    const values = {
      uom,
      budgetedHours: input.budgetedHours.toFixed(2),
      budgetedQuantity: input.budgetedQuantity.toFixed(2),
      ...(input.quantityComplete !== undefined
        ? { quantityComplete: input.quantityComplete.toFixed(2) }
        : {}),
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
    };
    await scope.tx
      .insert(costCodeProduction)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        costCodeId,
        quantityComplete: '0',
        ...values,
      })
      .onConflictDoUpdate({
        target: [costCodeProduction.projectId, costCodeProduction.costCodeId],
        set: values,
      });
    const [saved] = await scope.tx
      .select()
      .from(costCodeProduction)
      .where(
        and(
          eq(costCodeProduction.projectId, projectId),
          eq(costCodeProduction.costCodeId, costCodeId),
        ),
      );
    return {
      costCodeId,
      uom,
      budgetedHours: input.budgetedHours,
      budgetedQuantity: input.budgetedQuantity,
      quantityComplete: num(saved!.quantityComplete),
    };
  }

  /** Adds quantity in place for a day. Locks the plan row so the running total and the log stay in step. */
  async function logQuantity(
    scope: TenantScope,
    projectId: string,
    costCodeId: string,
    input: LogQuantityInput,
  ) {
    await need(scope, 'financials.production.log', projectId);
    if (!Number.isFinite(input.quantity) || input.quantity === 0)
      throw new AppError('validation_failed', 'Enter a quantity other than zero.', [
        { path: 'quantity', message: 'Must not be zero' },
      ]);
    const note = input.note?.trim() || null;
    if (input.quantity < 0 && !note)
      throw new AppError('validation_failed', 'Say why the quantity is being taken off.', [
        { path: 'note', message: 'Required for a correction' },
      ]);
    if (input.loggedOn > now().toISOString().slice(0, 10))
      throw new AppError('validation_failed', 'Quantity cannot be logged for a future day.', [
        { path: 'loggedOn', message: 'Must not be in the future' },
      ]);
    const [plan] = await scope.tx
      .select()
      .from(costCodeProduction)
      .where(
        and(
          eq(costCodeProduction.projectId, projectId),
          eq(costCodeProduction.costCodeId, costCodeId),
        ),
      )
      .for('update');
    if (!plan)
      throw new AppError(
        'financials.production.no_plan',
        'Set a production plan for this cost code before logging quantity.',
      );
    const total = Math.round((num(plan.quantityComplete) + input.quantity) * 100) / 100;
    if (total < 0)
      throw new AppError('validation_failed', 'That would take the quantity in place below zero.', [
        { path: 'quantity', message: 'Too much to take off' },
      ]);
    const id = uuidv7();
    const [created] = await scope.tx
      .insert(productionLog)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        costCodeId,
        loggedOn: input.loggedOn,
        quantity: input.quantity.toFixed(2),
        note,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await scope.tx
      .update(costCodeProduction)
      .set({ quantityComplete: total.toFixed(2), updatedAt: now(), updatedBy: scope.ctx.userId })
      .where(eq(costCodeProduction.id, plan.id));
    await recordRetention(scope, {
      recordType: 'financials.production_log',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    return { entry: created!, quantityComplete: total };
  }

  async function listLog(scope: TenantScope, projectId: string, costCodeId: string) {
    await need(scope, 'financials.budget.read', projectId);
    return scope.tx
      .select()
      .from(productionLog)
      .where(and(eq(productionLog.projectId, projectId), eq(productionLog.costCodeId, costCodeId)))
      .orderBy(desc(productionLog.loggedOn), desc(productionLog.createdAt))
      .limit(100);
  }

  /** The report as a CSV file (all rows for the filter), for the finance team's spreadsheets. */
  async function exportCsv(
    scope: TenantScope,
    projectId: string,
    filter: { divisionId?: string; subJobId?: string },
  ) {
    const r = await report(scope, projectId, filter);
    return {
      filename: 'labor-productivity.csv',
      csv: laborProductivityCsv(r.rows),
      count: r.rows.length,
    };
  }

  /** A cost code's figures and recent quantity entries for Nova (`ai`), without any worker detail. */
  async function laborFacts(scope: TenantScope, projectId: string, costCodeId: string) {
    const r = await report(scope, projectId, {});
    const row = r.rows.find((x) => x.costCodeId === costCodeId);
    if (!row) throw new AppError('financials.cost_code.not_found');
    if (row.budgetedHours === null || row.budgetedQuantity === null || row.uom === null)
      throw new AppError(
        'financials.production.no_plan',
        'Set a production plan for this cost code first.',
      );
    const log = await listLog(scope, projectId, costCodeId);
    return {
      costCode: row.code,
      description: row.description,
      uom: row.uom,
      row: {
        budgetedHours: row.budgetedHours,
        timesheetHours: row.timesheetHours,
        pctHoursUsed: row.pctHoursUsed,
        pctComplete: row.pctComplete,
        earnedHours: row.earnedHours,
        budgetedQuantity: row.budgetedQuantity,
        quantityComplete: row.quantityComplete ?? 0,
        budgetedRate: row.budgetedRate,
        actualRate: row.actualRate,
      },
      recent: log.slice(0, 20).map((e) => ({ loggedOn: e.loggedOn, quantity: Number(e.quantity) })),
      project: { flaggedRows: r.totals.flaggedRows, unallocatedHours: r.unallocatedHours },
    };
  }

  return { report, setProduction, logQuantity, listLog, exportCsv, laborFacts };
}

export type ProductivityService = ReturnType<typeof createProductivityService>;
