import { desc, eq } from 'drizzle-orm';
import type {
  CreditGrantKind,
  OrgAccountDto,
  OrgActionDto,
  SuspendCategory,
} from '@archova/contracts';
import { uuidv7 } from '@archova/domain';
import { AppError, type KernelServices, type Tx } from '@archova/kernel';
import type { AccountService, AccountSeed, OrgAccount } from '@archova/mod-billing';
import { orgActions, staffUsers, tenantDirectory } from '../infra/tables';
import type { StaffContext } from './staff';

export interface OrgActionDeps extends Pick<KernelServices, 'database'> {
  accounts: AccountService;
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

  /**
   * System action for the trial-expiry job: moves a lapsed trial to read-only and keeps the customer list in step.
   * No staff member acts, so there is no action-log row; the worker logs the org id. Returns whether it changed.
   */
  async function expireTrial(orgId: string, at: Date = now()): Promise<boolean> {
    return tx(async (t) => {
      const a = await deps.accounts.expireTrial(t, orgId, at);
      if (!a) return false;
      await syncDirectory(t, orgId, a);
      return true;
    });
  }

  return { account, list, grantCredits, extendTrial, changePlan, suspend, reactivate, expireTrial };
}

export type OrgActionService = ReturnType<typeof createOrgActionService>;
