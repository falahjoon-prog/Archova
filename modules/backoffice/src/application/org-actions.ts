import { desc, eq } from 'drizzle-orm';
import {
  PLAN_MODULE_KEYS,
  type CreditGrantKind,
  type OrgAccountDto,
  type OrgActionDto,
  type OrgDiscountDto,
  type OrgOverrideDto,
  type OrgRefundDto,
  type SuspendCategory,
} from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import {
  REFUND_APPROVAL_CENTS,
  type AccountService,
  type AccountSeed,
  type AdjustmentService,
  type OrgAccount,
} from '@archova/mod-billing';
import { orgActions, staffUsers, tenantDirectory } from '../infra/tables';
import type { RequestService } from './requests';
import type { StaffContext } from './staff';

/** A refund over A$5,000 waits this long when the only Owner requests it (Sam 12 §4). */
const REFUND_SOLO_COOLING_OFF_HOURS = 1;

export interface OrgActionDeps extends Pick<KernelServices, 'database'> {
  accounts: AccountService;
  adjustments: AdjustmentService;
  requests: RequestService;
  /** Nova credit grants live in the `ai` ledger; supplied lazily because `ai` is built after this module. */
  credits: () => {
    grantCredits: (
      orgId: string,
      staffId: string,
      input: { credits: number; kind: CreditGrantKind; reason: string; ticketRef: string },
    ) => Promise<{ id: string; periodStart: string }>;
  };
  now?: () => Date;
}

const toAccountDto = (a: OrgAccount): OrgAccountDto => ({
  plan: a.planCode,
  state: a.suspendedAt ? 'suspended' : a.state,
  trialEndsAt: a.trialEndsAt?.toISOString() ?? null,
  trialExtendedDays: a.trialExtendedDays,
  suspended:
    a.suspendedAt && a.suspendedCategory
      ? { category: a.suspendedCategory, at: a.suspendedAt.toISOString() }
      : null,
});

/**
 * Customer account actions (Sam 12 §3, backend 09 §6): extend a trial, move to a plan, suspend, reactivate.
 * The role rules sit here; the state rules (limits, valid plans) sit in `billing`. Each action commits with its
 * log row and the tenant directory update, and always needs a reason and a ticket.
 */
export function createOrgActionService(deps: OrgActionDeps) {
  const now = deps.now ?? (() => new Date());
  const tx = <T>(fn: (t: Tx) => Promise<T>) => deps.database.withGlobalTx('backoffice', fn);

  async function seed(t: Tx, orgId: string): Promise<AccountSeed> {
    const [org] = await t.select().from(tenantDirectory).where(eq(tenantDirectory.id, orgId));
    if (!org) throw new AppError('org.not_found');
    return { planCode: org.planCode, trialEndsAt: org.trialEndsAt };
  }

  /** Keeps the customer list in step with the account row. */
  async function syncDirectory(t: Tx, orgId: string, a: OrgAccount) {
    await t
      .update(tenantDirectory)
      .set({
        planCode: a.planCode,
        state: a.suspendedAt ? 'suspended' : a.state,
        trialEndsAt: a.trialEndsAt,
        updatedAt: new Date(),
      })
      .where(eq(tenantDirectory.id, orgId));
  }

  async function log(
    t: Tx,
    orgId: string,
    staff: StaffContext,
    kind: OrgActionDto['kind'],
    summary: string,
    input: { reason: string; ticketRef: string },
  ) {
    await t.insert(orgActions).values({
      id: uuidv7(),
      targetOrgId: orgId,
      kind,
      summary,
      reason: input.reason,
      ticketRef: input.ticketRef,
      staffId: staff.staffId,
    });
  }

  async function account(orgId: string): Promise<OrgAccountDto | null> {
    const a = await tx((t) => deps.accounts.get(t, orgId));
    return a ? toAccountDto(a) : null;
  }

  async function list(orgId: string, limit = 20): Promise<OrgActionDto[]> {
    const rows = await tx((t) =>
      t
        .select({ a: orgActions, by: staffUsers.name })
        .from(orgActions)
        .innerJoin(staffUsers, eq(staffUsers.id, orgActions.staffId))
        .where(eq(orgActions.targetOrgId, orgId))
        .orderBy(desc(orgActions.createdAt))
        .limit(limit),
    );
    return rows.map(({ a, by }) => ({
      id: a.id,
      kind: a.kind,
      summary: a.summary,
      reason: a.reason,
      ticketRef: a.ticketRef,
      by,
      at: a.createdAt.toISOString(),
    }));
  }

  type Common = { reason: string; ticketRef: string };

  async function extendTrial(staff: StaffContext, orgId: string, input: Common & { days: number }) {
    await tx(async (t) => {
      const a = await deps.accounts.extendTrial(t, orgId, await seed(t, orgId), {
        days: input.days,
        ownerOverride: staff.roles.includes('owner'),
        now: now(),
      });
      await syncDirectory(t, orgId, a);
      await log(
        t,
        orgId,
        staff,
        'trial.extend',
        `Extended the trial by ${input.days} days (${a.trialExtendedDays} in total)`,
        input,
      );
    });
  }

  async function changePlan(
    staff: StaffContext,
    orgId: string,
    input: Common & { planCode: string },
  ) {
    await tx(async (t) => {
      const before = await seed(t, orgId);
      const a = await deps.accounts.setPlan(t, orgId, before, input.planCode);
      await syncDirectory(t, orgId, a);
      await log(
        t,
        orgId,
        staff,
        'plan.change',
        `Moved from ${before.planCode} to ${a.planCode}`,
        input,
      );
    });
  }

  const actingRole = (staff: StaffContext) =>
    (staff.roles.includes('owner') ? 'owner' : (staff.roles[0] ?? 'staff')).replace(/_/g, ' ');

  async function suspend(
    staff: StaffContext,
    orgId: string,
    input: Common & { category: SuspendCategory },
  ) {
    // A Security lead may suspend only in a security emergency; the other reasons are the Owner's (Sam 12 §3).
    if (!staff.roles.includes('owner') && input.category !== 'security')
      throw new AppError(
        'backoffice.permission_denied',
        'Only an Owner can suspend for abuse, fraud or a legal order.',
      );
    await tx(async (t) => {
      const a = await deps.accounts.suspend(t, orgId, await seed(t, orgId), input.category, now());
      await syncDirectory(t, orgId, a);
      await log(
        t,
        orgId,
        staff,
        'suspend',
        `Suspended (${input.category.replace('_', ' ')}) by ${actingRole(staff)}`,
        input,
      );
    });
  }

  async function reactivate(staff: StaffContext, orgId: string, input: Common) {
    await tx(async (t) => {
      await seed(t, orgId);
      const a = await deps.accounts.reactivate(t, orgId);
      await syncDirectory(t, orgId, a);
      await log(
        t,
        orgId,
        staff,
        'reactivate',
        `Reactivated after suspension by ${actingRole(staff)}`,
        input,
      );
    });
  }

  /**
   * Adds Nova credits to the org's current month. The grant carries its own reason and ticket in the ai ledger, so it is
   * written first; the action log row follows. A suspended or cancelled org may still be granted credits.
   */
  async function grantCredits(
    staff: StaffContext,
    orgId: string,
    input: Common & { credits: number; kind: CreditGrantKind },
  ) {
    await tx((t) => seed(t, orgId));
    const { periodStart } = await deps.credits().grantCredits(orgId, staff.staffId, input);
    await tx((t) =>
      log(
        t,
        orgId,
        staff,
        'credits.grant',
        `Granted ${input.credits} Nova credits (${input.kind.replace('_', '-')}) for ${periodStart.slice(0, 7)}`,
        input,
      ),
    );
  }

  const money = (cents: number) => `A$${(cents / 100).toFixed(2)}`;
  const isOwner = (staff: StaffContext) => staff.roles.includes('owner');

  async function addDiscount(
    staff: StaffContext,
    orgId: string,
    input: Common & { percent: number; months: number },
  ) {
    await tx(async (t) => {
      await seed(t, orgId);
      const d = await deps.adjustments.addDiscount(t, orgId, staff.staffId, {
        ...input,
        ownerOverride: isOwner(staff),
        now: now(),
      });
      await log(
        t,
        orgId,
        staff,
        'discount.add',
        `Discount of ${d.percent}% from ${d.startsOn} to ${d.endsOn}`,
        input,
      );
    });
  }

  async function revokeDiscount(
    staff: StaffContext,
    orgId: string,
    discountId: string,
    input: Common,
  ) {
    await tx(async (t) => {
      const d = await deps.adjustments.revokeDiscount(t, orgId, discountId, staff.staffId, now());
      await log(
        t,
        orgId,
        staff,
        'discount.revoke',
        `Ended the ${d.percent}% discount early`,
        input,
      );
    });
  }

  async function grantOverride(
    staff: StaffContext,
    orgId: string,
    input: Common & {
      kind: 'module' | 'limit';
      key: string;
      limitValue: number | null;
      days: number;
    },
  ) {
    await tx(async (t) => {
      await seed(t, orgId);
      const o = await deps.adjustments.grantOverride(t, orgId, staff.staffId, {
        ...input,
        ownerOverride: isOwner(staff),
        validModules: PLAN_MODULE_KEYS,
        now: now(),
      });
      const what = o.kind === 'module' ? `Added ${o.key}` : `Set ${o.key} to ${o.limitValue}`;
      await log(
        t,
        orgId,
        staff,
        'override.grant',
        `${what} for ${input.days} days (until ${o.expiresAt.toISOString().slice(0, 10)})`,
        input,
      );
    });
  }

  async function revokeOverride(
    staff: StaffContext,
    orgId: string,
    overrideId: string,
    input: Common,
  ) {
    await tx(async (t) => {
      const o = await deps.adjustments.revokeOverride(t, orgId, overrideId, staff.staffId, now());
      await log(t, orgId, staff, 'override.revoke', `Ended the ${o.key} override early`, input);
    });
  }

  /**
   * Records a refund. Up to A$5,000 it is approved and logged at once. Over that, the record waits and a `refund`
   * request goes to a second Owner (or, with a sole Owner, back to them after a 1 hour delay). If the request cannot
   * be created, the record is cancelled so nothing is left pending.
   */
  async function refund(
    staff: StaffContext,
    orgId: string,
    input: Common & { invoiceRef: string; amountCents: number; paidCents: number },
  ) {
    const row = await tx(async (t) => {
      await seed(t, orgId);
      const r = await deps.adjustments.createRefund(t, orgId, staff.staffId, input);
      if (r.status === 'approved')
        await log(
          t,
          orgId,
          staff,
          'refund',
          `Refund of ${money(r.amountCents)} on invoice ${r.invoiceRef}`,
          input,
        );
      return r;
    });
    if (row.status === 'approved') return;
    try {
      await deps.requests.create(staff, {
        kind: 'refund',
        subjectRef: row.id,
        subjectLabel: `Refund of ${money(row.amountCents)} on invoice ${row.invoiceRef}`,
        reason: input.reason,
        orgId,
        coolingOffHours: REFUND_SOLO_COOLING_OFF_HOURS,
        preview: {
          invoiceRef: row.invoiceRef,
          amountCents: row.amountCents,
          paidCents: row.paidCents,
          ticketRef: row.ticketRef,
          approvalOverCents: REFUND_APPROVAL_CENTS,
        },
      });
    } catch (e) {
      await tx((t) => deps.adjustments.settleRefund(t, row.id, 'cancelled', null, now()));
      throw e;
    }
  }

  async function adjustments(orgId: string) {
    const at = now();
    const today = at.toISOString().slice(0, 10);
    const [discounts, overrides, refunds] = await tx((t) =>
      Promise.all([
        deps.adjustments.listDiscounts(t, orgId),
        deps.adjustments.listOverrides(t, orgId),
        deps.adjustments.listRefunds(t, orgId),
      ]),
    );
    return {
      discounts: discounts.map((d): OrgDiscountDto => ({
        id: d.id,
        percent: d.percent,
        startsOn: d.startsOn,
        endsOn: d.endsOn,
        reason: d.reason,
        ticketRef: d.ticketRef,
        status: d.revokedAt ? 'revoked' : d.endsOn > today ? 'active' : 'ended',
      })),
      overrides: overrides.map((o): OrgOverrideDto => ({
        id: o.id,
        kind: o.kind,
        key: o.key,
        limitValue: o.limitValue,
        expiresAt: o.expiresAt.toISOString(),
        reason: o.reason,
        ticketRef: o.ticketRef,
        status: o.revokedAt ? 'revoked' : o.expiresAt > at ? 'live' : 'expired',
      })),
      refunds: refunds.map((r): OrgRefundDto => ({
        id: r.id,
        invoiceRef: r.invoiceRef,
        amountCents: r.amountCents,
        paidCents: r.paidCents,
        reason: r.reason,
        ticketRef: r.ticketRef,
        status: r.status,
        at: r.createdAt.toISOString(),
      })),
    };
  }

  return {
    account,
    list,
    adjustments,
    grantCredits,
    extendTrial,
    changePlan,
    suspend,
    reactivate,
    addDiscount,
    revokeDiscount,
    grantOverride,
    revokeOverride,
    refund,
  };
}

export type OrgActionService = ReturnType<typeof createOrgActionService>;
