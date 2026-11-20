import {
  SOPA_RULES,
  adjudicationDeadline,
  noScheduleAdjudication,
  ruleInForce,
} from '@archova/domain';
import type { SopaState } from '@archova/domain';
import { compareLocalDates, localDateOf, type LocalDate } from '@archova/time';
import { PUBLIC_HOLIDAYS } from './holidays';
import { percentOf } from './money';

// The claim-to-schedule-to-adjudication timeline shown on a claim. Pure: built from the dates stored on the claim,
// the payment schedule if one was issued, and what has been paid. It never moves a stored date; the adjudication
// windows come from the rule row in force on the service date (compliance/01 §2). Wording says "likely" because the
// rows have not been signed off by a lawyer.

export type TimelineStatus = 'done' | 'upcoming' | 'due_soon' | 'overdue' | 'closed';

export interface TimelineStep {
  key:
    | 'served'
    | 'schedule'
    | 'payment'
    | 'adjudication_schedule_less'
    | 'adjudication_unpaid'
    | 'adjudication_notice'
    | 'adjudication_apply';
  label: string;
  /** The deadline, when the step has one. */
  dueOn: LocalDate | null;
  /** The day it happened, when it has. */
  doneOn: LocalDate | null;
  status: TimelineStatus;
  note: string | null;
}

export interface TimelineInput {
  ruleState: string | null;
  isValid: boolean;
  servedOn: LocalDate | null;
  scheduleDueOn: LocalDate | null;
  paymentDueOn: LocalDate | null;
  claimedTotalCents: number;
  schedule: { issuedAt: Date; scheduledCents: number } | null;
  /** Paid so far, inc GST, net of reversals. */
  paidCents: number;
  today: LocalDate;
  timeZone: string;
}

/** Days that count as "soon" for a deadline. */
export const TIMELINE_SOON_DAYS = 3;

const daysBetween = (a: LocalDate, b: LocalDate) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function deadlineStatus(dueOn: LocalDate, today: LocalDate, overdue: TimelineStatus) {
  const left = daysBetween(today, dueOn);
  if (left < 0) return overdue;
  return left <= TIMELINE_SOON_DAYS ? 'due_soon' : 'upcoming';
}

export function claimTimeline(input: TimelineInput): TimelineStep[] {
  if (!input.isValid || !input.servedOn || !input.scheduleDueOn || !input.paymentDueOn) return [];
  const { today } = input;
  const rule = input.ruleState
    ? ruleInForce(SOPA_RULES, input.ruleState as SopaState, input.servedOn)
    : null;
  const holidays = rule ? PUBLIC_HOLIDAYS[rule.state] : new Set<string>();
  const steps: TimelineStep[] = [
    {
      key: 'served',
      label: 'Claim served',
      dueOn: null,
      doneOn: input.servedOn,
      status: 'done',
      note: null,
    },
  ];

  const sched = input.schedule;
  const scheduleGivenOn = sched ? localDateOf(sched.issuedAt, input.timeZone) : null;
  const onTime = scheduleGivenOn
    ? compareLocalDates(scheduleGivenOn, input.scheduleDueOn) <= 0
    : null;
  steps.push({
    key: 'schedule',
    label: 'Payment schedule deadline',
    dueOn: input.scheduleDueOn,
    doneOn: scheduleGivenOn,
    status: scheduleGivenOn ? 'done' : deadlineStatus(input.scheduleDueOn, today, 'overdue'),
    note: scheduleGivenOn
      ? onTime
        ? 'Given in time.'
        : 'Given after the due date, so the full claim is likely payable.'
      : compareLocalDates(today, input.scheduleDueOn) > 0
        ? 'Not given in time. The full claim is likely payable.'
        : 'If no schedule is given by this day, the full claim is likely payable.',
  });

  const scheduledInc = sched ? sched.scheduledCents + percentOf(sched.scheduledCents, 1000) : null;
  const owing = scheduledInc ?? input.claimedTotalCents;
  const paid = input.paidCents >= owing && owing > 0;
  steps.push({
    key: 'payment',
    label: 'Payment due',
    dueOn: input.paymentDueOn,
    doneOn: null,
    status: paid ? 'done' : deadlineStatus(input.paymentDueOn, today, 'overdue'),
    note: paid ? 'Paid in full.' : scheduledInc !== null ? 'Due on the scheduled amount.' : null,
  });

  if (!rule) return steps;
  const window = (due: LocalDate) =>
    compareLocalDates(today, due) > 0 ? 'closed' : deadlineStatus(due, today, 'closed');

  if (sched && scheduledInc !== null && scheduledInc < input.claimedTotalCents && scheduleGivenOn) {
    const due = adjudicationDeadline({ rule, holidays, scheduleGivenOn });
    if (due)
      steps.push({
        key: 'adjudication_schedule_less',
        label: 'Last day to apply for adjudication (schedule was for less)',
        dueOn: due,
        doneOn: null,
        status: window(due),
        note: 'Runs from the day the schedule was given.',
      });
  }
  if (sched && !paid) {
    const due = adjudicationDeadline({ rule, holidays, paymentDueOn: input.paymentDueOn });
    if (due && compareLocalDates(today, input.paymentDueOn) > 0)
      steps.push({
        key: 'adjudication_unpaid',
        label: 'Last day to apply for adjudication (scheduled amount unpaid)',
        dueOn: due,
        doneOn: null,
        status: window(due),
        note: 'Runs from the payment due date.',
      });
  }
  if (!sched && compareLocalDates(today, input.scheduleDueOn) > 0) {
    const r = noScheduleAdjudication({
      rule,
      holidays,
      paymentDueOn: input.paymentDueOn,
      scheduleDueOn: input.scheduleDueOn,
    });
    if (r.kind === 'notice')
      steps.push({
        key: 'adjudication_notice',
        label: 'Last day to serve notice of intention to apply for adjudication',
        dueOn: r.noticeBy,
        doneOn: null,
        status: window(r.noticeBy),
        note: 'The respondent then has a short time to give a schedule before the claimant can apply.',
      });
    else
      steps.push({
        key: 'adjudication_apply',
        label: 'Last day to apply for adjudication (no schedule given)',
        dueOn: r.applyBy,
        doneOn: null,
        status: window(r.applyBy),
        note: 'Runs from the later of the payment due date and the last day for a schedule.',
      });
  }
  return steps;
}

/** The one step a person should look at now: overdue before due soon, then the earliest date. Null when all is calm. */
export function mostUrgentStep(steps: readonly TimelineStep[]): TimelineStep | null {
  const hot = steps.filter((s) => s.status === 'overdue' || s.status === 'due_soon');
  hot.sort(
    (a, b) =>
      Number(b.status === 'overdue') - Number(a.status === 'overdue') ||
      compareLocalDates(a.dueOn ?? '9999-12-31', b.dueOn ?? '9999-12-31'),
  );
  return hot[0] ?? null;
}
