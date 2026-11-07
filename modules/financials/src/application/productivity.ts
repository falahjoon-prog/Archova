import { and, eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import {
  divisionOf,
  isWithin,
  productivityRow,
  productivityTotals,
  type CodeNode,
  type Plan,
} from '../domain/productivity';
import { costCodeProduction, costCodes } from '../infra/tables';

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
  quantityComplete: number;
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
      quantityComplete: input.quantityComplete.toFixed(2),
      updatedAt: now(),
      updatedBy: scope.ctx.userId,
    };
    await scope.tx
      .insert(costCodeProduction)
      .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, costCodeId, ...values })
      .onConflictDoUpdate({
        target: [costCodeProduction.projectId, costCodeProduction.costCodeId],
        set: values,
      });
    return {
      costCodeId,
      uom,
      budgetedHours: input.budgetedHours,
      budgetedQuantity: input.budgetedQuantity,
      quantityComplete: input.quantityComplete,
    };
  }

  return { report, setProduction };
}

export type ProductivityService = ReturnType<typeof createProductivityService>;
