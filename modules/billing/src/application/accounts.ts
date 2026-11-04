import { and, eq, sql } from 'drizzle-orm';
import { AppError, type Tx } from '@archova/kernel';
import { orgAccounts, planVersions, plans, type SuspendCategory } from '../infra/tables';

const DAY_MS = 86_400_000;
/** One extension is at most 30 days; 120 in total unless an Owner does it (Sam 12 §3). */
export const MAX_TRIAL_EXTENSION_DAYS = 30;
export const MAX_TRIAL_TOTAL_DAYS = 120;

export type OrgAccount = typeof orgAccounts.$inferSelect;

/** What the account starts from when the first staff action creates its row (from the tenant directory). */
export interface AccountSeed {
  planCode: string;
  trialEndsAt: Date | null;
}

/** Org account commands. Every command takes the caller's transaction so the action log commits with it. */
export function createAccountService() {
  async function get(tx: Tx, orgId: string): Promise<OrgAccount | null> {
    const [row] = await tx.select().from(orgAccounts).where(eq(orgAccounts.id, orgId));
    return row ?? null;
  }

  async function ensure(tx: Tx, orgId: string, seed: AccountSeed): Promise<OrgAccount> {
    await tx
      .insert(orgAccounts)
      .values({
        id: orgId,
        planCode: seed.planCode,
        state: seed.planCode === 'trial' ? 'trialing' : 'active',
        trialEndsAt: seed.trialEndsAt,
      })
      .onConflictDoNothing();
    return (await get(tx, orgId))!;
  }

  /** Adds days to the trial end (or to now when it has already ended). `ownerOverride` lifts the 120-day cap. */
  async function extendTrial(
    tx: Tx,
    orgId: string,
    seed: AccountSeed,
    input: { days: number; ownerOverride: boolean; now: Date },
  ): Promise<OrgAccount> {
    const acct = await ensure(tx, orgId, seed);
    if (acct.planCode !== 'trial')
      throw new AppError('backoffice.not_on_trial', 'This company is not on a trial.');
    if (input.days < 1 || input.days > MAX_TRIAL_EXTENSION_DAYS)
      throw new AppError(
        'backoffice.trial_limit',
        `An extension is 1 to ${MAX_TRIAL_EXTENSION_DAYS} days.`,
      );
    const total = acct.trialExtendedDays + input.days;
    if (total > MAX_TRIAL_TOTAL_DAYS && !input.ownerOverride)
      throw new AppError(
        'backoffice.trial_limit',
        `Extensions are limited to ${MAX_TRIAL_TOTAL_DAYS} days in total without an Owner.`,
      );
    const base = acct.trialEndsAt && acct.trialEndsAt > input.now ? acct.trialEndsAt : input.now;
    const [row] = await tx
      .update(orgAccounts)
      .set({
        trialEndsAt: new Date(base.getTime() + input.days * DAY_MS),
        trialExtendedDays: total,
        updatedAt: sql`now()`,
      })
      .where(eq(orgAccounts.id, orgId))
      .returning();
    return row!;
  }

  /** Moves a company to a plan that has a published version (an upgrade takes effect at once). */
  async function setPlan(
    tx: Tx,
    orgId: string,
    seed: AccountSeed,
    planCode: string,
  ): Promise<OrgAccount> {
    const acct = await ensure(tx, orgId, seed);
    if (planCode !== 'trial') {
      const [live] = await tx
        .select({ id: planVersions.id })
        .from(planVersions)
        .where(and(eq(planVersions.planCode, planCode), eq(planVersions.status, 'published')));
      if (!live) throw new AppError('backoffice.plan_not_found', 'That plan is not published.');
    }
    // A downgrade happens at term end, not by a console click (Sam 12 §3).
    const order = async (code: string) =>
      code === 'trial'
        ? 0
        : ((await tx.select({ n: plans.sortOrder }).from(plans).where(eq(plans.code, code)))[0]
            ?.n ?? 0);
    if ((await order(planCode)) < (await order(acct.planCode)))
      throw new AppError(
        'backoffice.downgrade_at_term_end',
        'A downgrade takes effect at the end of the term and is not done from here.',
      );
    const [row] = await tx
      .update(orgAccounts)
      .set({
        planCode,
        state: planCode === 'trial' ? 'trialing' : 'active',
        trialEndsAt: planCode === 'trial' ? acct.trialEndsAt : null,
        updatedAt: sql`now()`,
      })
      .where(eq(orgAccounts.id, orgId))
      .returning();
    return row!;
  }

  async function suspend(
    tx: Tx,
    orgId: string,
    seed: AccountSeed,
    category: SuspendCategory,
    now: Date,
  ): Promise<OrgAccount> {
    const acct = await ensure(tx, orgId, seed);
    if (acct.suspendedAt)
      throw new AppError('backoffice.already_suspended', 'This company is already suspended.');
    const [row] = await tx
      .update(orgAccounts)
      .set({ suspendedCategory: category, suspendedAt: now, updatedAt: sql`now()` })
      .where(eq(orgAccounts.id, orgId))
      .returning();
    return row!;
  }

  async function reactivate(tx: Tx, orgId: string): Promise<OrgAccount> {
    const acct = await get(tx, orgId);
    if (!acct?.suspendedAt)
      throw new AppError('backoffice.not_suspended', 'This company is not suspended.');
    const [row] = await tx
      .update(orgAccounts)
      .set({ suspendedCategory: null, suspendedAt: null, updatedAt: sql`now()` })
      .where(eq(orgAccounts.id, orgId))
      .returning();
    return row!;
  }

  return { get, extendTrial, setPlan, suspend, reactivate };
}

export type AccountService = ReturnType<typeof createAccountService>;
