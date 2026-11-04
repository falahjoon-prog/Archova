import { and, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { OVERRIDE_LIMIT_KEYS } from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type Tx } from '@archova/kernel';
import { orgDiscounts, orgOverrides, orgRefunds, type RefundStatus } from '../infra/tables';

const DAY_MS = 86_400_000;

/** A discount over this percent, or an override longer than 90 days, needs an Owner (backend 09 §6, Sam 12 §3). */
export const MAX_DISCOUNT_PERCENT_STAFF = 20;
export const MAX_DISCOUNT_MONTHS = 12;
export const MAX_OVERRIDE_DAYS_STAFF = 90;
export const MAX_OVERRIDE_DAYS_OWNER = 365;
/** A refund above this waits for a second person (A$5,000, in cents). */
export const REFUND_APPROVAL_CENTS = 500_000;
/** Modules a lower plan does not include; adding one by override needs an Owner. */
export const ENTERPRISE_ONLY_OVERRIDE_MODULES: readonly string[] = ['api'];
export { OVERRIDE_LIMIT_KEYS };

export type OrgDiscount = typeof orgDiscounts.$inferSelect;
export type OrgOverride = typeof orgOverrides.$inferSelect;
export type OrgRefund = typeof orgRefunds.$inferSelect;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addMonths = (d: Date, n: number) => {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
};

/**
 * Discounts, overrides and refund records for a customer account. Like `accounts`, every command takes the
 * caller's transaction so the staff action log commits with it. The role gates sit in `backoffice`; the limits that
 * depend on who is acting come in as `ownerOverride`.
 */
export function createAdjustmentService() {
  // --- discounts -----------------------------------------------------------------------------------------------

  async function activeDiscount(tx: Tx, orgId: string, now: Date) {
    const [row] = await tx
      .select()
      .from(orgDiscounts)
      .where(
        and(
          eq(orgDiscounts.targetOrgId, orgId),
          isNull(orgDiscounts.revokedAt),
          sql`${orgDiscounts.endsOn} > ${isoDay(now)}`,
        ),
      );
    return row ?? null;
  }

  async function addDiscount(
    tx: Tx,
    orgId: string,
    staffId: string,
    input: {
      percent: number;
      months: number;
      reason: string;
      ticketRef: string;
      ownerOverride: boolean;
      now: Date;
    },
  ): Promise<OrgDiscount> {
    if (!Number.isInteger(input.percent) || input.percent < 1 || input.percent > 100)
      throw new AppError('backoffice.discount_limit', 'A discount is 1 to 100 percent.');
    if (!Number.isInteger(input.months) || input.months < 1 || input.months > MAX_DISCOUNT_MONTHS)
      throw new AppError(
        'backoffice.discount_limit',
        `A discount lasts 1 to ${MAX_DISCOUNT_MONTHS} months.`,
      );
    if (input.percent > MAX_DISCOUNT_PERCENT_STAFF && !input.ownerOverride)
      throw new AppError(
        'backoffice.discount_limit',
        `A discount over ${MAX_DISCOUNT_PERCENT_STAFF}% needs an Owner.`,
      );
    // One at a time: two discounts would stack silently and nobody would see the real price.
    if (await activeDiscount(tx, orgId, input.now))
      throw new AppError(
        'backoffice.discount_exists',
        'This company already has a discount. Revoke it first.',
      );
    const [row] = await tx
      .insert(orgDiscounts)
      .values({
        id: uuidv7(),
        targetOrgId: orgId,
        percent: input.percent,
        startsOn: isoDay(input.now),
        endsOn: isoDay(addMonths(input.now, input.months)),
        reason: input.reason,
        ticketRef: input.ticketRef,
        createdBy: staffId,
      })
      .returning();
    return row!;
  }

  async function revokeDiscount(
    tx: Tx,
    orgId: string,
    discountId: string,
    staffId: string,
    now: Date,
  ): Promise<OrgDiscount> {
    const [row] = await tx
      .update(orgDiscounts)
      .set({ revokedAt: now, revokedBy: staffId })
      .where(
        and(
          eq(orgDiscounts.id, discountId),
          eq(orgDiscounts.targetOrgId, orgId),
          isNull(orgDiscounts.revokedAt),
        ),
      )
      .returning();
    if (!row) throw new AppError('backoffice.discount_not_found', 'That discount is not active.');
    return row;
  }

  const listDiscounts = (tx: Tx, orgId: string, limit = 20) =>
    tx
      .select()
      .from(orgDiscounts)
      .where(eq(orgDiscounts.targetOrgId, orgId))
      .orderBy(desc(orgDiscounts.createdAt))
      .limit(limit);

  // --- overrides -----------------------------------------------------------------------------------------------

  async function grantOverride(
    tx: Tx,
    orgId: string,
    staffId: string,
    input: {
      kind: 'module' | 'limit';
      key: string;
      limitValue: number | null;
      days: number;
      reason: string;
      ticketRef: string;
      ownerOverride: boolean;
      /** Plan modules the company has, so an override cannot silently duplicate what it already bought. */
      validModules: readonly string[];
      now: Date;
    },
  ): Promise<OrgOverride> {
    if (input.kind === 'module') {
      if (!input.validModules.includes(input.key))
        throw new AppError('backoffice.override_key', 'That module does not exist.');
      if (input.limitValue !== null)
        throw new AppError('backoffice.override_key', 'A module override has no value.');
    } else {
      if (!(OVERRIDE_LIMIT_KEYS as readonly string[]).includes(input.key))
        throw new AppError('backoffice.override_key', 'That limit cannot be overridden.');
      if (input.limitValue === null || !Number.isInteger(input.limitValue) || input.limitValue < 0)
        throw new AppError('backoffice.override_key', 'A limit override needs a whole number.');
    }
    if (!Number.isInteger(input.days) || input.days < 1 || input.days > MAX_OVERRIDE_DAYS_OWNER)
      throw new AppError(
        'backoffice.override_limit',
        `An override lasts 1 to ${MAX_OVERRIDE_DAYS_OWNER} days.`,
      );
    if (input.days > MAX_OVERRIDE_DAYS_STAFF && !input.ownerOverride)
      throw new AppError(
        'backoffice.override_limit',
        `An override over ${MAX_OVERRIDE_DAYS_STAFF} days needs an Owner.`,
      );
    if (
      input.kind === 'module' &&
      ENTERPRISE_ONLY_OVERRIDE_MODULES.includes(input.key) &&
      !input.ownerOverride
    )
      throw new AppError(
        'backoffice.override_limit',
        'This module is for higher plans, so an Owner must grant it.',
      );
    // One live override per key: a second grant replaces confusion with a clear "revoke it first".
    const [live] = await tx
      .select({ id: orgOverrides.id })
      .from(orgOverrides)
      .where(
        and(
          eq(orgOverrides.targetOrgId, orgId),
          eq(orgOverrides.key, input.key),
          isNull(orgOverrides.revokedAt),
          gt(orgOverrides.expiresAt, input.now),
        ),
      );
    if (live)
      throw new AppError(
        'backoffice.override_exists',
        'This company already has a live override for that key. Revoke it first.',
      );
    const [row] = await tx
      .insert(orgOverrides)
      .values({
        id: uuidv7(),
        targetOrgId: orgId,
        kind: input.kind,
        key: input.key,
        limitValue: input.limitValue,
        expiresAt: new Date(input.now.getTime() + input.days * DAY_MS),
        reason: input.reason,
        ticketRef: input.ticketRef,
        createdBy: staffId,
      })
      .returning();
    return row!;
  }

  async function revokeOverride(
    tx: Tx,
    orgId: string,
    overrideId: string,
    staffId: string,
    now: Date,
  ): Promise<OrgOverride> {
    const [row] = await tx
      .update(orgOverrides)
      .set({ revokedAt: now, revokedBy: staffId })
      .where(
        and(
          eq(orgOverrides.id, overrideId),
          eq(orgOverrides.targetOrgId, orgId),
          isNull(orgOverrides.revokedAt),
          gt(orgOverrides.expiresAt, now),
        ),
      )
      .returning();
    if (!row) throw new AppError('backoffice.override_not_found', 'That override is not live.');
    return row;
  }

  const listOverrides = (tx: Tx, orgId: string, limit = 20) =>
    tx
      .select()
      .from(orgOverrides)
      .where(eq(orgOverrides.targetOrgId, orgId))
      .orderBy(desc(orgOverrides.createdAt))
      .limit(limit);

  /** Live (not revoked, not expired) overrides; the entitlement provider reads these on every request. */
  const liveOverrides = (tx: Tx, orgId: string, now: Date) =>
    tx
      .select()
      .from(orgOverrides)
      .where(
        and(
          eq(orgOverrides.targetOrgId, orgId),
          isNull(orgOverrides.revokedAt),
          gt(orgOverrides.expiresAt, now),
        ),
      );

  // --- refunds -------------------------------------------------------------------------------------------------

  /**
   * Records a refund. At or under A$5,000 it is approved at once; over, it waits as `pending_approval` for the
   * second person (the backoffice request decides it). A refund cannot exceed what the invoice collected, counting
   * refunds already recorded against it, and the invoice's paid amount cannot change between refunds.
   */
  async function createRefund(
    tx: Tx,
    orgId: string,
    staffId: string,
    input: {
      invoiceRef: string;
      amountCents: number;
      paidCents: number;
      reason: string;
      ticketRef: string;
    },
  ): Promise<OrgRefund> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0)
      throw new AppError('backoffice.refund_limit', 'The refund amount must be more than zero.');
    if (!Number.isInteger(input.paidCents) || input.paidCents <= 0)
      throw new AppError('backoffice.refund_limit', 'Enter what the invoice collected.');
    const earlier = await tx
      .select()
      .from(orgRefunds)
      .where(
        and(
          eq(orgRefunds.targetOrgId, orgId),
          eq(orgRefunds.invoiceRef, input.invoiceRef),
          ne(orgRefunds.status, 'cancelled'),
        ),
      );
    if (earlier.some((r) => r.paidCents !== input.paidCents))
      throw new AppError(
        'backoffice.refund_limit',
        'This invoice already has a refund recorded against a different paid amount.',
      );
    const already = earlier.reduce((n, r) => n + r.amountCents, 0);
    if (already + input.amountCents > input.paidCents)
      throw new AppError(
        'backoffice.refund_limit',
        'A refund cannot be more than the invoice collected, counting refunds already recorded.',
      );
    const needsSecond = input.amountCents > REFUND_APPROVAL_CENTS;
    const [row] = await tx
      .insert(orgRefunds)
      .values({
        id: uuidv7(),
        targetOrgId: orgId,
        invoiceRef: input.invoiceRef,
        amountCents: input.amountCents,
        paidCents: input.paidCents,
        reason: input.reason,
        ticketRef: input.ticketRef,
        status: needsSecond ? 'pending_approval' : 'approved',
        requestedBy: staffId,
        approvedBy: needsSecond ? null : staffId,
        decidedAt: needsSecond ? null : new Date(),
      })
      .returning();
    return row!;
  }

  /** Settles a pending refund when its request is approved (`approved`) or rejected, cancelled or failed. */
  async function settleRefund(
    tx: Tx,
    refundId: string,
    status: Extract<RefundStatus, 'approved' | 'cancelled'>,
    by: string | null,
    now: Date,
  ): Promise<OrgRefund> {
    const [row] = await tx
      .update(orgRefunds)
      .set({ status, approvedBy: status === 'approved' ? by : null, decidedAt: now })
      .where(and(eq(orgRefunds.id, refundId), eq(orgRefunds.status, 'pending_approval')))
      .returning();
    if (!row) throw new AppError('backoffice.request_not_pending', 'That refund is not waiting.');
    return row;
  }

  const getRefund = async (tx: Tx, refundId: string) =>
    (await tx.select().from(orgRefunds).where(eq(orgRefunds.id, refundId)))[0] ?? null;

  const listRefunds = (tx: Tx, orgId: string, limit = 20) =>
    tx
      .select()
      .from(orgRefunds)
      .where(eq(orgRefunds.targetOrgId, orgId))
      .orderBy(desc(orgRefunds.createdAt))
      .limit(limit);

  return {
    addDiscount,
    revokeDiscount,
    listDiscounts,
    activeDiscount,
    grantOverride,
    revokeOverride,
    listOverrides,
    liveOverrides,
    createRefund,
    settleRefund,
    getRefund,
    listRefunds,
  };
}

export type AdjustmentService = ReturnType<typeof createAdjustmentService>;
