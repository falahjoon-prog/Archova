import { and, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, toCents } from '../domain/money';
import { budgetLines, directCosts } from '../infra/tables';

export type DirectCostRow = typeof directCosts.$inferSelect;

export interface DirectCostsDeps {
  access: AccessService;
  now?: () => Date;
}

export interface RecordDirectCostInput {
  budgetLineId: string;
  category: DirectCostRow['category'];
  description: string;
  supplier?: string;
  reference?: string;
  /** yyyy-mm-dd, not in the future. */
  incurredOn: string;
  /** Ex GST, more than zero. */
  amount: string;
  /** The GST on top, zero if none. */
  gst?: string;
}

/**
 * Direct costs: money spent on a project outside a subcontract or purchase order. Builder staff only. A cost adds to
 * its budget line's `actual` under the line row lock; a void takes it back. Nothing is edited or deleted.
 */
export function createDirectCostsService(deps: DirectCostsDeps) {
  const now = deps.now ?? (() => new Date());

  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can work with direct costs.");
  };

  async function row(scope: TenantScope, projectId: string, id: string) {
    const [r] = await scope.tx
      .select()
      .from(directCosts)
      .where(and(eq(directCosts.id, id), eq(directCosts.projectId, projectId)))
      .limit(1);
    if (!r) throw new AppError('financials.direct_cost.not_found');
    return r;
  }

  /** Locks the budget line, then moves its actual by `deltaCents`. */
  async function moveActual(
    scope: TenantScope,
    projectId: string,
    budgetLineId: string,
    deltaCents: number,
  ) {
    const [line] = await scope.tx
      .select()
      .from(budgetLines)
      .where(and(eq(budgetLines.id, budgetLineId), eq(budgetLines.projectId, projectId)))
      .for('update');
    if (!line)
      throw new AppError(
        'financials.budget.line_not_found',
        'That budget line is not on this project.',
      );
    await scope.tx
      .update(budgetLines)
      .set({ actual: fromCents(Math.max(toCents(line.actual) + deltaCents, 0)) })
      .where(eq(budgetLines.id, line.id));
  }

  async function recordDirectCost(
    scope: TenantScope,
    projectId: string,
    input: RecordDirectCostInput,
  ) {
    await need(scope, 'financials.direct_costs.manage', projectId);
    if (toCents(input.amount) <= 0)
      throw new AppError('validation_failed', 'A direct cost must be for more than zero.', [
        { path: 'amount', message: 'Must be more than zero' },
      ]);
    if (input.incurredOn > now().toISOString().slice(0, 10))
      throw new AppError('validation_failed', 'A cost cannot be incurred in the future.', [
        { path: 'incurredOn', message: 'Must not be in the future' },
      ]);
    // Lock the line first (also proves it is on this project), then number under the project lock.
    await moveActual(scope, projectId, input.budgetLineId, toCents(input.amount));
    await scope.tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${'direct_costs:' + projectId}, 0))`,
    );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${directCosts.number}), 0) + 1` })
      .from(directCosts)
      .where(eq(directCosts.projectId, projectId));
    const id = uuidv7();
    const [created] = await scope.tx
      .insert(directCosts)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        number: Number(n!.n),
        budgetLineId: input.budgetLineId,
        category: input.category,
        description: input.description.trim(),
        supplier: input.supplier?.trim() || null,
        reference: input.reference?.trim() || null,
        incurredOn: input.incurredOn,
        amount: input.amount,
        gst: input.gst ?? '0',
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.direct_costs',
      recordId: id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    scope.events.add({
      type: 'financials.direct_cost.recorded.v1',
      projectId,
      entityType: 'direct_cost',
      entityId: id,
      entityVersion: created!.version,
      data: {
        directCostId: id,
        number: created!.number,
        budgetLineId: input.budgetLineId,
        amount: created!.amount,
      },
    });
    return created!;
  }

  async function listDirectCosts(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.direct_costs.read', projectId);
    const rows = await scope.tx
      .select()
      .from(directCosts)
      .where(eq(directCosts.projectId, projectId))
      .orderBy(desc(directCosts.number));
    const total = rows
      .filter((r) => r.status === 'recorded')
      .reduce((n, r) => n + toCents(r.amount), 0);
    return { rows, total: fromCents(total) };
  }

  async function getDirectCost(scope: TenantScope, projectId: string, id: string) {
    await need(scope, 'financials.direct_costs.read', projectId);
    return row(scope, projectId, id);
  }

  async function voidDirectCost(scope: TenantScope, projectId: string, id: string, note: string) {
    await need(scope, 'financials.direct_costs.manage', projectId);
    if (!note.trim())
      throw new AppError(
        'financials.direct_cost.reason_required',
        'Give the reason for voiding this cost.',
        [{ path: 'note', message: 'Required' }],
      );
    const c = await row(scope, projectId, id);
    if (c.status === 'void') throw new AppError('financials.direct_cost.already_void');
    await moveActual(scope, projectId, c.budgetLineId, -toCents(c.amount));
    const [updated] = await scope.tx
      .update(directCosts)
      .set({
        status: 'void',
        voidReason: note.trim(),
        voidedAt: now(),
        voidedBy: scope.ctx.userId,
        version: c.version + 1,
      })
      .where(and(eq(directCosts.id, id), eq(directCosts.version, c.version)))
      .returning();
    if (!updated) throw new AppError('conflict', 'This cost just changed. Reload and try again.');
    scope.events.add({
      type: 'financials.direct_cost.voided.v1',
      projectId,
      entityType: 'direct_cost',
      entityId: id,
      entityVersion: updated.version,
      data: { directCostId: id, number: c.number, amount: c.amount },
    });
    return updated;
  }

  return { recordDirectCost, listDirectCosts, getDirectCost, voidDirectCost };
}

export type DirectCostsService = ReturnType<typeof createDirectCostsService>;
