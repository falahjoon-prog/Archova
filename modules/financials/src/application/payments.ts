import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { localDateOf } from '@archova/time';
import { AppError, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { PlatformApi } from '@archova/mod-platform';
import { fromCents, isMoney, percentOf, toCents } from '../domain/money';
import { paymentClaims, paymentSchedules, payments } from '../infra/tables';

export type PaymentRow = typeof payments.$inferSelect;

export interface PaymentsDeps {
  access: AccessService;
  platform: Pick<PlatformApi, 'getProject'>;
  /** Throws `financials.contract.not_found` unless the caller may see the contract (a payee sees only theirs). */
  contractFor: (
    scope: TenantScope,
    projectId: string,
    contractId: string,
    seeAll?: boolean,
  ) => Promise<unknown>;
  now?: () => Date;
}

export interface RecordPaymentInput {
  /** yyyy-mm-dd, not in the future. */
  paidOn: string;
  /** Ex nothing: the amount that left the bank, including GST, more than zero. */
  amount: string;
  reference: string;
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

/**
 * Payments made against a payment claim, recorded by hand for builders who do not run Xero or MYOB. The same
 * append-only `payments` table the connectors write to: a mistake is undone by a reversal, never an edit.
 * Recording or reversing moves the claim between `scheduled` and `paid` as the amount due is met.
 */
export function createPaymentsService(deps: PaymentsDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadClaim(scope: TenantScope, projectId: string, claimId: string) {
    const [claim] = await scope.tx
      .select()
      .from(paymentClaims)
      .where(and(eq(paymentClaims.id, claimId), eq(paymentClaims.projectId, projectId)))
      .limit(1);
    if (!claim) throw new AppError('financials.claim.not_found');
    return claim;
  }

  async function staff(scope: TenantScope, projectId: string) {
    await deps.access.assert(scope, 'financials.claims.assess', { projectId });
    if (scope.ctx.principalType !== 'member')
      throw new AppError('access.denied', "Only the builder's staff can record payments.");
  }

  /** Amount due including GST at 10% of the scheduled amount, or null before a payment schedule is issued. */
  async function dueCents(scope: TenantScope, claimId: string) {
    const [s] = await scope.tx
      .select({ scheduledAmount: paymentSchedules.scheduledAmount })
      .from(paymentSchedules)
      .where(eq(paymentSchedules.claimId, claimId))
      .limit(1);
    if (!s) return null;
    const base = toCents(s.scheduledAmount);
    return base + percentOf(base, 1000);
  }

  async function paidCents(scope: TenantScope, claimId: string) {
    const [r] = await scope.tx
      .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)` })
      .from(payments)
      .where(eq(payments.claimId, claimId));
    return Math.round(Number(r?.total ?? 0) * 100);
  }

  async function summary(scope: TenantScope, claim: typeof paymentClaims.$inferSelect) {
    const rows = await scope.tx
      .select()
      .from(payments)
      .where(eq(payments.claimId, claim.id))
      .orderBy(asc(payments.recordedAt));
    const due = await dueCents(scope, claim.id);
    const paid = await paidCents(scope, claim.id);
    return {
      claimId: claim.id,
      payments: rows,
      amountDue: due === null ? null : fromCents(due),
      paid: fromCents(paid),
      outstanding: due === null ? null : fromCents(Math.max(0, due - paid)),
    };
  }

  /** `scheduled` becomes `paid` once the amount due is met, and goes back if a reversal takes it under. */
  async function syncStatus(scope: TenantScope, claim: typeof paymentClaims.$inferSelect) {
    const due = await dueCents(scope, claim.id);
    if (due === null) return;
    const paid = await paidCents(scope, claim.id);
    const next =
      claim.status === 'scheduled' && paid >= due
        ? 'paid'
        : claim.status === 'paid' && paid < due
          ? 'scheduled'
          : null;
    if (!next) return;
    await scope.tx
      .update(paymentClaims)
      .set({ status: next, version: claim.version + 1 })
      .where(eq(paymentClaims.id, claim.id));
  }

  async function list(scope: TenantScope, projectId: string, claimId: string) {
    await deps.access.assert(scope, 'financials.claims.read', { projectId });
    const claim = await loadClaim(scope, projectId, claimId);
    await deps.contractFor(scope, projectId, claim.contractId, false).catch(() => {
      throw new AppError('financials.claim.not_found');
    });
    return summary(scope, claim);
  }

  function emit(scope: TenantScope, projectId: string, row: PaymentRow) {
    scope.events.add({
      type: 'financials.payment.recorded.v1',
      projectId,
      entityType: 'payment',
      entityId: row.id,
      entityVersion: 1,
      data: {
        paymentId: row.id,
        claimId: row.claimId,
        paidOn: row.paidOn,
        amount: row.amount,
        source: row.source,
        externalRef: row.externalRef,
        reversesPaymentId: row.reversesPaymentId,
      },
    });
  }

  async function record(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    input: RecordPaymentInput,
  ) {
    await staff(scope, projectId);
    const claim = await loadClaim(scope, projectId, claimId);
    if ((await dueCents(scope, claim.id)) === null)
      throw new AppError(
        'financials.payment.no_schedule',
        'Issue the payment schedule before recording a payment.',
      );
    if (!isMoney(input.amount) || toCents(input.amount) <= 0)
      throw invalid('amount', 'Enter an amount greater than zero.');
    const reference = input.reference.trim();
    if (!reference) throw invalid('reference', 'Give the payment a reference.');
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    if (input.paidOn > today) throw invalid('paidOn', 'The payment date is in the future.');
    const [row] = await scope.tx
      .insert(payments)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId: claim.id,
        paidOn: input.paidOn,
        amount: fromCents(toCents(input.amount)),
        reference: reference.slice(0, 100),
        source: 'manual',
      })
      .returning();
    emit(scope, projectId, row!);
    await syncStatus(scope, claim);
    return summary(scope, await loadClaim(scope, projectId, claimId));
  }

  /** Undo a payment by recording the same amount back, dated today. A payment can be reversed once. */
  async function reverse(
    scope: TenantScope,
    projectId: string,
    claimId: string,
    paymentId: string,
    note?: string,
  ) {
    await staff(scope, projectId);
    const claim = await loadClaim(scope, projectId, claimId);
    const [original] = await scope.tx
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.claimId, claim.id)))
      .limit(1);
    if (!original) throw new AppError('financials.payment.not_found');
    const [already] = await scope.tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.reversesPaymentId, original.id))
      .limit(1);
    if (original.reversesPaymentId || already)
      throw new AppError(
        'financials.payment.not_reversible',
        original.reversesPaymentId
          ? 'That entry is already a reversal.'
          : 'That payment has already been reversed.',
      );
    const today = localDateOf(now(), (await deps.platform.getProject(scope, projectId)).timezone);
    const [row] = await scope.tx
      .insert(payments)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        claimId: claim.id,
        paidOn: today,
        amount: fromCents(-toCents(original.amount)),
        reference: (note?.trim() || `Reversal of ${original.reference}`).slice(0, 100),
        source: 'manual',
        reversesPaymentId: original.id,
      })
      .returning();
    emit(scope, projectId, row!);
    await syncStatus(scope, claim);
    return summary(scope, await loadClaim(scope, projectId, claimId));
  }

  return { list, record, reverse };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
