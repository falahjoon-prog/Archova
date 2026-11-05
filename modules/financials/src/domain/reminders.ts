import { addDays, compareLocalDates, isoWeekday, localDateOf, type LocalDate } from '@archova/time';
import { fromCents } from './money';
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
  unpaidClaims: readonly {
    claimId: string;
    number: number;
    paymentDueOn: LocalDate;
    outstandingCents: number;
  }[];
}

export type ReminderKind =
  'financials.trust_attention' | 'financials.retention_release_due' | 'financials.payment_overdue';

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
