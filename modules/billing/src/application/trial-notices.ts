import { and, eq } from 'drizzle-orm';
import type { EmailMessage, Tx } from '@archova/kernel';
import { orgAccounts, trialNotices } from '../infra/tables';

const DAY_MS = 86_400_000;

/** Days before the trial ends that a company is emailed, largest first. */
export const TRIAL_NOTICE_DAYS = [3, 1] as const;

/**
 * The notice due for a trial: the smallest threshold the remaining time has crossed, or null when the trial is not
 * within the largest window or has already ended. Always the smallest, so an org that is first seen with a day left
 * gets one email, not one per threshold.
 */
export function dueNoticeDays(trialEndsAt: Date, now: Date): number | null {
  const remaining = trialEndsAt.getTime() - now.getTime();
  if (remaining <= 0) return null;
  const crossed = TRIAL_NOTICE_DAYS.filter((d) => remaining <= d * DAY_MS);
  return crossed.length ? Math.min(...crossed) : null;
}

export interface TrialEndingEmailInput {
  orgName: string;
  recipientName: string;
  recipientEmail: string;
  trialEndsAt: Date;
  daysBefore: number;
  timeZone: string;
  appUrl: string;
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

/** Plain, brand-neutral copy; the end date is shown in the company's own time zone (X34). */
export function renderTrialEndingEmail(i: TrialEndingEmailInput): EmailMessage {
  const when = new Intl.DateTimeFormat('en-AU', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: i.timeZone,
  }).format(i.trialEndsAt);
  const lead =
    i.daysBefore === 1
      ? `The Archova trial for ${i.orgName} ends tomorrow.`
      : `The Archova trial for ${i.orgName} ends in ${i.daysBefore} days.`;
  const detail = `It ends on ${when}. After that your projects become read-only: nothing is deleted, and everything is editable again as soon as you choose a plan.`;
  const cta = 'Choose a plan, or reply to this email if you need more time.';
  return {
    to: i.recipientEmail,
    subject: `Your Archova trial ends ${i.daysBefore === 1 ? 'tomorrow' : `in ${i.daysBefore} days`}`,
    text: `Hi ${i.recipientName},\n\n${lead} ${detail}\n\n${cta}\n${i.appUrl}\n`,
    html: `<p>Hi ${esc(i.recipientName)},</p><p>${esc(lead)} ${esc(detail)}</p><p>${esc(cta)}<br><a href="${esc(i.appUrl)}">${esc(i.appUrl)}</a></p>`,
  };
}

export function createTrialNoticeService() {
  /** The account's trial end when it is still a running trial, else null. */
  async function runningTrialEnd(tx: Tx, orgId: string): Promise<Date | null> {
    const [a] = await tx.select().from(orgAccounts).where(eq(orgAccounts.id, orgId));
    if (!a || a.planCode !== 'trial' || a.state !== 'trialing' || !a.trialEndsAt) return null;
    return a.trialEndsAt;
  }

  /** Records the notice; false when it was already claimed (so nothing is sent twice). */
  async function claim(
    tx: Tx,
    orgId: string,
    trialEndsAt: Date,
    daysBefore: number,
    recipients: number,
  ): Promise<boolean> {
    const rows = await tx
      .insert(trialNotices)
      .values({ accountId: orgId, trialEndsAt, daysBefore, recipients })
      .onConflictDoNothing()
      .returning();
    return rows.length > 0;
  }

  /** Gives a claim back after a failed send, so the next run tries again. */
  async function release(tx: Tx, orgId: string, trialEndsAt: Date, daysBefore: number) {
    await tx
      .delete(trialNotices)
      .where(
        and(
          eq(trialNotices.accountId, orgId),
          eq(trialNotices.trialEndsAt, trialEndsAt),
          eq(trialNotices.daysBefore, daysBefore),
        ),
      );
  }

  return { runningTrialEnd, claim, release };
}

export type TrialNoticeService = ReturnType<typeof createTrialNoticeService>;
