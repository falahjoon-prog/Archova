import { addDays, compareLocalDates, isoWeekday, localDateOf, type LocalDate } from '@archova/time';
import { SOPA_RULES, adjudicationDeadline, ruleInForce, type SopaState } from '@archova/domain';
import { PUBLIC_HOLIDAYS } from './holidays';
import { fromCents, percentOf } from './money';
import { releaseStages, type ReleaseStage, type ReleaseTermsInput } from './release';
import { trustPosition, trustRequirement, trustTotals, type MovementInput } from './trust';

// In-app reminders for retention trust and retention release (decision D5: record and remind). Pure. The people told
// are the builder staff who created the contract. Wording says "likely": the trust thresholds have not been signed off.

export interface ReminderContract {
  contractId: string;
  projectId: string;
  /** The staff member who created the contract: the one person told. */
  ownerUserId: string;
  number: number;
  title: string;
  sopaState: string;
  valueCents: number;
  governmentClient: boolean;
  trustSetUp: boolean;
  retentionWithheldCents: number;
  movements: readonly MovementInput[];
  terms: ReleaseTermsInput;
  releasedByStage: Partial<Record<ReleaseStage, number>>;
  /** Valid claims with a payment schedule and an amount still owing (schedule plus GST, less paid). */
  openClaims?: readonly OpenSopaClaim[];
  unpaidClaims: readonly {
    claimId: string;
    number: number;
    paymentDueOn: LocalDate;
    outstandingCents: number;
  }[];
}

/** A valid claim still inside its SOPA windows: no payment schedule yet, or a schedule for less than the claim. */
export interface OpenSopaClaim {
  claimId: string;
  number: number;
  scheduleDueOn: LocalDate;
  claimedTotalCents: number;
  /** Set once a payment schedule has been issued. */
  schedule: { issuedAt: Date; scheduledCents: number } | null;
}

export type ReminderKind =
  | 'financials.trust_attention'
  | 'financials.retention_release_due'
  | 'financials.payment_overdue'
  | 'financials.schedule_due'
  | 'financials.adjudication_window';

/** Days before a SOPA deadline the reminders start. */
export const SOPA_NOTICE_DAYS = 3;

/** How long past its due date an unpaid claim still gets its reminder. */
export const OVERDUE_WINDOW_DAYS = 60;

export interface PlannedReminder {
  userId: string;
  projectId: string;
  contractId: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** Trust: once a week per problem. Release: once per stage and due date. A rerun never repeats either. */
  dedupeKey: string;
}

const STAGE_LABEL: Record<ReleaseStage, string> = {
  practical_completion: 'at practical completion',
  defects_end: 'at the end of the defects period',
};

export function planReminders(
  contracts: readonly ReminderContract[],
  now: Date,
  ctx: { zoneOf: (projectId: string) => string | null; isMember: (userId: string) => boolean },
): PlannedReminder[] {
  const out: PlannedReminder[] = [];
  for (const c of contracts) {
    const zone = ctx.zoneOf(c.projectId);
    if (!zone || !ctx.isMember(c.ownerUserId)) continue;
    const today: LocalDate = localDateOf(now, zone);
    const label = `C-${String(c.number).padStart(3, '0')} ${c.title}`;

    const rule = ruleInForce(SOPA_RULES, c.sopaState as SopaState, today);
    for (const q of c.openClaims ?? []) {
      if (!rule) break;
      const holidays = PUBLIC_HOLIDAYS[rule.state];
      if (!q.schedule) {
        const left = daysBetween(today, q.scheduleDueOn);
        if (left >= 0 && left <= SOPA_NOTICE_DAYS) {
          out.push({
            userId: c.ownerUserId,
            projectId: c.projectId,
            contractId: c.contractId,
            kind: 'financials.schedule_due',
            title: `${label}: payment schedule for claim ${q.number} is due ${left === 0 ? 'today' : q.scheduleDueOn}`,
            body: `No payment schedule has been given. If none is issued by the end of ${q.scheduleDueOn}, the full $${fromCents(q.claimedTotalCents)} is likely payable.`,
            dedupeKey: `schedule-due:${q.claimId}:${q.scheduleDueOn}:${today}`,
          });
        } else if (left < 0 && left >= -OVERDUE_WINDOW_DAYS) {
          out.push({
            userId: c.ownerUserId,
            projectId: c.projectId,
            contractId: c.contractId,
            kind: 'financials.schedule_due',
            title: `${label}: no payment schedule was given for claim ${q.number} in time`,
            body: `The schedule was due on ${q.scheduleDueOn}. The full $${fromCents(q.claimedTotalCents)} is likely payable, and the claimant may now start the adjudication steps.`,
            dedupeKey: `schedule-missed:${q.claimId}`,
          });
        }
        continue;
      }
      // A schedule for less than the claim opens the claimant's adjudication window.
      const scheduledWithGst =
        q.schedule.scheduledCents + percentOf(q.schedule.scheduledCents, 1000);
      if (scheduledWithGst >= q.claimedTotalCents) continue;
      const givenOn = localDateOf(q.schedule.issuedAt, zone);
      const closes = adjudicationDeadline({ rule, holidays, scheduleGivenOn: givenOn });
      if (!closes) continue;
      const left = daysBetween(today, closes);
      if (left < 0 || left > SOPA_NOTICE_DAYS) continue;
      out.push({
        userId: c.ownerUserId,
        projectId: c.projectId,
        contractId: c.contractId,
        kind: 'financials.adjudication_window',
        title: `${label}: adjudication window for claim ${q.number} closes ${left === 0 ? 'today' : closes}`,
        body: `The schedule of ${givenOn} was for less than the claim. The last day to apply for adjudication is ${closes}.`,
        dedupeKey: `adjudication-window:${q.claimId}:${closes}:${today}`,
      });
    }

    for (const q of c.unpaidClaims) {
      if (q.outstandingCents <= 0 || compareLocalDates(q.paymentDueOn, today) >= 0) continue;
      if (compareLocalDates(q.paymentDueOn, addDays(today, -OVERDUE_WINDOW_DAYS)) < 0) continue;
      out.push({
        userId: c.ownerUserId,
        projectId: c.projectId,
        contractId: c.contractId,
        kind: 'financials.payment_overdue',
        title: `${label}: claim ${q.number} is past its payment due date`,
        body: `$${fromCents(q.outstandingCents)} was due on ${q.paymentDueOn} and has not been paid.`,
        dedupeKey: `payment-overdue:${q.claimId}:${q.paymentDueOn}`,
      });
    }

    const requirement = trustRequirement({
      sopaState: c.sopaState,
      valueCents: c.valueCents,
      governmentClient: c.governmentClient,
    });
    const position = trustPosition({
      required: requirement.required,
      setUp: c.trustSetUp,
      retentionWithheldCents: c.retentionWithheldCents,
      totals: trustTotals(c.movements),
    });
    if (position.status === 'not_set_up' || position.status === 'shortfall') {
      const week = addDays(today, 1 - isoWeekday(today));
      out.push({
        userId: c.ownerUserId,
        projectId: c.projectId,
        contractId: c.contractId,
        kind: 'financials.trust_attention',
        title:
          position.status === 'not_set_up'
            ? `${label}: retention trust account not recorded`
            : `${label}: retention trust account is short`,
        body:
          position.status === 'not_set_up'
            ? `A retention trust likely applies and $${fromCents(position.requiredInTrustCents)} of retention is held. Record the account details.`
            : `$${fromCents(position.shortfallCents)} less than the retention held is in the trust account. Record the deposit.`,
        dedupeKey: `trust:${c.contractId}:${position.status}:${week}`,
      });
    }

    for (const s of releaseStages({
      terms: c.terms,
      retentionHeldCents: c.retentionWithheldCents,
      releasedByStage: c.releasedByStage,
      today,
    })) {
      if (s.status !== 'due' || s.dueOn === null || s.remainingCents <= 0) continue;
      if (compareLocalDates(s.dueOn, today) > 0) continue;
      out.push({
        userId: c.ownerUserId,
        projectId: c.projectId,
        contractId: c.contractId,
        kind: 'financials.retention_release_due',
        title: `${label}: retention release is due`,
        body: `$${fromCents(s.remainingCents)} of retention falls due for release ${STAGE_LABEL[s.stage]}.`,
        dedupeKey: `release:${c.contractId}:${s.stage}:${s.dueOn}`,
      });
    }
  }
  return out;
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
