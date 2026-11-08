import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, recordRetention, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fromCents, toCents } from '../domain/money';
import {
  budgetLines,
  commitmentChangeOrders,
  commitmentPayments,
  commitments,
} from '../infra/tables';

export type ChangeOrderRow = typeof commitmentChangeOrders.$inferSelect;
export type PaymentRow = typeof commitmentPayments.$inferSelect;

export interface CommitmentActivityDeps {
  access: AccessService;
  now?: () => Date;
}

const SIGNED = /^-?\d{1,16}(\.\d{1,2})?$/;
export const signedCents = (v: string) => {
  if (!SIGNED.test(v)) throw new RangeError(`Invalid money: ${v}`);
  return v.startsWith('-') ? -toCents(v.slice(1)) : toCents(v);
};

export type ChangeOrderMove = 'submitted' | 'approved' | 'rejected';
const CO_FROM: Record<ChangeOrderMove, string[]> = {
  submitted: ['draft'],
  approved: ['submitted'],
  rejected: ['submitted'],
};

/**
 * Change orders and payments on a commitment. Builder staff only. An approved change order moves the commitment's
 * revised value and its budget line's committed cost; payments are capped at the revised value.
 */
export function createCommitmentActivityService(deps: CommitmentActivityDeps) {
  const now = deps.now ?? (() => new Date());

  const need = async (scope: TenantScope, key: string, projectId: string) => {
    await deps.access.assert(scope, key, { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can work with commitments.");
  };

  // The commitment row is locked so a change order or payment cannot race another against the same cap.
  async function lockedCommitment(scope: TenantScope, projectId: string, id: string) {
    const [c] = await scope.tx
      .select()
      .from(commitments)
      .where(and(eq(commitments.id, id), eq(commitments.projectId, projectId)))
      .for('update')
      .limit(1);
    if (!c) throw new AppError('financials.commitment.not_found');
    return c;
  }

  async function approvedChanges(scope: TenantScope, commitmentId: string) {
    const [r] = await scope.tx
      .select({ s: sql<string>`coalesce(sum(${commitmentChangeOrders.amount}), 0)` })
      .from(commitmentChangeOrders)
      .where(
        and(
          eq(commitmentChangeOrders.commitmentId, commitmentId),
          eq(commitmentChangeOrders.status, 'approved'),
        ),
      );
    return signedCents(String(r!.s));
  }
  async function paidSoFar(scope: TenantScope, commitmentId: string) {
    const [r] = await scope.tx
      .select({ s: sql<string>`coalesce(sum(${commitmentPayments.amount}), 0)` })
      .from(commitmentPayments)
      .where(
        and(
          eq(commitmentPayments.commitmentId, commitmentId),
          eq(commitmentPayments.status, 'recorded'),
        ),
      );
    return toCents(String(r!.s));
  }

  async function listChangeOrders(scope: TenantScope, projectId: string, commitmentId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    return scope.tx
      .select()
      .from(commitmentChangeOrders)
      .where(
        and(
          eq(commitmentChangeOrders.projectId, projectId),
          eq(commitmentChangeOrders.commitmentId, commitmentId),
        ),
      )
      .orderBy(asc(commitmentChangeOrders.number));
  }

  async function createChangeOrder(
    scope: TenantScope,
    projectId: string,
    commitmentId: string,
    input: { title: string; budgetLineId: string; amount: string },
  ) {
    await need(scope, 'financials.commitments.manage', projectId);
    const cents = signedCents(input.amount);
    if (cents === 0)
      throw new AppError('validation_failed', 'The amount cannot be zero.', [
        { path: 'amount', message: 'Must not be zero' },
      ]);
    const c = await lockedCommitment(scope, projectId, commitmentId);
    if (c.status !== 'approved')
      throw new AppError(
        'financials.commitment.not_approved',
        'Change orders can only be raised on an approved commitment.',
      );
    const [line] = await scope.tx
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(and(eq(budgetLines.id, input.budgetLineId), eq(budgetLines.projectId, projectId)))
      .limit(1);
    if (!line)
      throw new AppError(
        'financials.budget.line_not_found',
        'A budget line is not on this project.',
      );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${commitmentChangeOrders.number}), 0) + 1` })
      .from(commitmentChangeOrders)
      .where(eq(commitmentChangeOrders.commitmentId, commitmentId));
    const [created] = await scope.tx
      .insert(commitmentChangeOrders)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        commitmentId,
        number: Number(n!.n),
        title: input.title.trim(),
        budgetLineId: input.budgetLineId,
        amount: fromCents(cents),
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.commitment_change_orders',
      recordId: created!.id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    return created!;
  }

  async function moveChangeOrder(
    scope: TenantScope,
    projectId: string,
    commitmentId: string,
    id: string,
    to: ChangeOrderMove,
    opts: { note?: string } = {},
  ) {
    await need(
      scope,
      to === 'submitted' ? 'financials.commitments.manage' : 'financials.commitments.decide',
      projectId,
    );
    const c = await lockedCommitment(scope, projectId, commitmentId);
    const [co] = await scope.tx
      .select()
      .from(commitmentChangeOrders)
      .where(
        and(
          eq(commitmentChangeOrders.id, id),
          eq(commitmentChangeOrders.commitmentId, commitmentId),
        ),
      )
      .limit(1);
    if (!co) throw new AppError('financials.commitment.change_order_not_found');
    if (!CO_FROM[to].includes(co.status))
      throw new AppError(
        'financials.commitment.bad_state',
        `A change order that is ${co.status} can't be ${to}.`,
      );
    if (to === 'rejected' && !(opts.note ?? '').trim())
      throw new AppError(
        'financials.commitment.reason_required',
        'Give the reason for rejecting this change order.',
        [{ path: 'note', message: 'Required' }],
      );
    if (to === 'approved') {
      if (c.status !== 'approved')
        throw new AppError(
          'financials.commitment.not_approved',
          'The commitment is no longer approved.',
        );
      const delta = signedCents(co.amount);
      const [b] = await scope.tx
        .select()
        .from(budgetLines)
        .where(eq(budgetLines.id, co.budgetLineId))
        .for('update');
      const committed = toCents(b!.committed) + delta;
      if (committed < 0)
        throw new AppError(
          'financials.commitment.below_zero',
          'This would take committed cost on the budget line below zero.',
        );
      if (delta > 0 && committed > toCents(b!.original) + signedCents(b!.approvedChanges))
        throw new AppError(
          'financials.commitment.over_budget',
          'Approving this would take a budget line past its budget.',
        );
      // A reduction cannot cut the commitment below what has already been paid on it.
      const revised = toCents(c.total) + (await approvedChanges(scope, commitmentId)) + delta;
      if (revised < (await paidSoFar(scope, commitmentId)))
        throw new AppError(
          'financials.commitment.overpaid',
          'This would take the commitment below what has already been paid.',
        );
      await scope.tx
        .update(budgetLines)
        .set({ committed: fromCents(committed) })
        .where(eq(budgetLines.id, b!.id));
    }
    const at = now();
    const [updated] = await scope.tx
      .update(commitmentChangeOrders)
      .set({
        status: to,
        version: co.version + 1,
        ...(to === 'submitted' ? { submittedAt: at, submittedBy: scope.ctx.userId } : {}),
        ...(to !== 'submitted'
          ? { decidedAt: at, decidedBy: scope.ctx.userId, decisionNote: opts.note?.trim() || null }
          : {}),
      })
      .where(and(eq(commitmentChangeOrders.id, id), eq(commitmentChangeOrders.version, co.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This change order just changed. Reload and try again.');
    scope.events.add({
      type: `financials.commitment_change_order.${to}.v1`,
      projectId,
      entityType: 'commitment_change_order',
      entityId: id,
      entityVersion: updated.version,
      data: { commitmentId, number: co.number, amount: co.amount },
    });
    return updated;
  }

  async function listPayments(scope: TenantScope, projectId: string, commitmentId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    return scope.tx
      .select()
      .from(commitmentPayments)
      .where(
        and(
          eq(commitmentPayments.projectId, projectId),
          eq(commitmentPayments.commitmentId, commitmentId),
        ),
      )
      .orderBy(desc(commitmentPayments.number));
  }

  async function recordPayment(
    scope: TenantScope,
    projectId: string,
    commitmentId: string,
    input: { amount: string; paidOn: string; reference?: string | null },
  ) {
    await need(scope, 'financials.commitments.manage', projectId);
    const cents = toCents(input.amount);
    if (cents <= 0)
      throw new AppError('validation_failed', 'The payment must be for more than zero.', [
        { path: 'amount', message: 'Must be more than zero' },
      ]);
    if (input.paidOn > now().toISOString().slice(0, 10))
      throw new AppError('validation_failed', 'The payment date cannot be in the future.', [
        { path: 'paidOn', message: 'Must not be in the future' },
      ]);
    const c = await lockedCommitment(scope, projectId, commitmentId);
    if (c.status !== 'approved')
      throw new AppError(
        'financials.commitment.not_approved',
        'Payments can only be recorded against an approved commitment.',
      );
    const revised = toCents(c.total) + (await approvedChanges(scope, commitmentId));
    if ((await paidSoFar(scope, commitmentId)) + cents > revised)
      throw new AppError(
        'financials.commitment.overpaid',
        'This would take payments past the commitment value.',
      );
    const [n] = await scope.tx
      .select({ n: sql<number>`coalesce(max(${commitmentPayments.number}), 0) + 1` })
      .from(commitmentPayments)
      .where(eq(commitmentPayments.commitmentId, commitmentId));
    const [created] = await scope.tx
      .insert(commitmentPayments)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        commitmentId,
        number: Number(n!.n),
        amount: fromCents(cents),
        paidOn: input.paidOn,
        reference: input.reference?.trim() || null,
        createdBy: scope.ctx.userId,
      })
      .returning();
    await recordRetention(scope, {
      recordType: 'financials.commitment_payments',
      recordId: created!.id,
      projectId,
      category: 'financial_7y',
      anchor: created!.createdAt,
    });
    scope.events.add({
      type: 'financials.commitment_payment.recorded.v1',
      projectId,
      entityType: 'commitment_payment',
      entityId: created!.id,
      entityVersion: 1,
      data: { commitmentId, number: created!.number, amount: created!.amount },
    });
    return created!;
  }

  async function voidPayment(
    scope: TenantScope,
    projectId: string,
    commitmentId: string,
    id: string,
    reason: string,
  ) {
    await need(scope, 'financials.commitments.manage', projectId);
    if (!reason.trim())
      throw new AppError(
        'financials.commitment.reason_required',
        'Give the reason for voiding this payment.',
        [{ path: 'note', message: 'Required' }],
      );
    await lockedCommitment(scope, projectId, commitmentId);
    const [p] = await scope.tx
      .select()
      .from(commitmentPayments)
      .where(and(eq(commitmentPayments.id, id), eq(commitmentPayments.commitmentId, commitmentId)))
      .limit(1);
    if (!p) throw new AppError('financials.commitment.payment_not_found');
    if (p.status === 'void')
      throw new AppError('financials.commitment.bad_state', 'This payment is already void.');
    const [updated] = await scope.tx
      .update(commitmentPayments)
      .set({
        status: 'void',
        voidReason: reason.trim(),
        voidedAt: now(),
        voidedBy: scope.ctx.userId,
        version: p.version + 1,
      })
      .where(and(eq(commitmentPayments.id, id), eq(commitmentPayments.version, p.version)))
      .returning();
    if (!updated)
      throw new AppError('conflict', 'This payment just changed. Reload and try again.');
    return updated;
  }

  /** Project-wide figures for the Commitments totals bar, in cents. */
  async function summary(scope: TenantScope, projectId: string) {
    await need(scope, 'financials.commitments.read', projectId);
    type Sum = { count: number; cents: number };
    const fold = (rows: { status: string; n: number; s: string }[]) => {
      const by = (st: string): Sum => {
        const r = rows.find((x) => x.status === st);
        return { count: r?.n ?? 0, cents: r ? signedCents(String(r.s)) : 0 };
      };
      return by;
    };
    const c = fold(
      await scope.tx
        .select({
          status: commitments.status,
          n: sql<number>`count(*)::int`,
          s: sql<string>`coalesce(sum(${commitments.total}), 0)`,
        })
        .from(commitments)
        .where(eq(commitments.projectId, projectId))
        .groupBy(commitments.status),
    );
    const co = fold(
      await scope.tx
        .select({
          status: commitmentChangeOrders.status,
          n: sql<number>`count(*)::int`,
          s: sql<string>`coalesce(sum(${commitmentChangeOrders.amount}), 0)`,
        })
        .from(commitmentChangeOrders)
        .where(eq(commitmentChangeOrders.projectId, projectId))
        .groupBy(commitmentChangeOrders.status),
    );
    const pay = fold(
      await scope.tx
        .select({
          status: commitmentPayments.status,
          n: sql<number>`count(*)::int`,
          s: sql<string>`coalesce(sum(${commitmentPayments.amount}), 0)`,
        })
        .from(commitmentPayments)
        .where(eq(commitmentPayments.projectId, projectId))
        .groupBy(commitmentPayments.status),
    );
    return {
      approvedCommitments: c('approved'),
      pendingCommitments: c('submitted'),
      draftCommitments: c('draft'),
      approvedChangeOrders: co('approved'),
      pendingChangeOrders: co('submitted'),
      draftChangeOrders: co('draft'),
      payments: pay('recorded'),
    };
  }

  return {
    listChangeOrders,
    createChangeOrder,
    moveChangeOrder,
    listPayments,
    recordPayment,
    voidPayment,
    summary,
  };
}

export type CommitmentActivityService = ReturnType<typeof createCommitmentActivityService>;
