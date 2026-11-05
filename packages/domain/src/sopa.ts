// SOPA deadline engine (docs: compliance/01 §5-6, financials schema). Pure: the server stores the result and
// clients use it for previews only. Rule rows are reference data; a row without `verifiedBy` is usable in test and
// pilot orgs only and the result says `rulesReviewed: false`. Dates are the end of that local day.

import {
  type BusinessDayCalendar,
  type Instant,
  type LocalDate,
  addBusinessDays,
  addDays,
  compareLocalDates,
  localDateOf,
  parseLocalDate,
} from '@archova/time';

export type SopaState = 'NSW' | 'VIC' | 'QLD';
export type ContractKind = 'head' | 'subcontract';

export interface SopaRule {
  state: SopaState;
  effectiveFrom: LocalDate;
  effectiveTo: LocalDate | null;
  actName: string;
  /** Business days the respondent has to give a payment schedule. */
  scheduleDays: number;
  /** Caps on the payment period; the contract may shorten, never extend. */
  paymentCapHead: number;
  paymentCapSub: number;
  /** Payment period when the contract is silent; null means the cap (compliance/02 N3 reads NSW that way). */
  paymentDefaultDays: number | null;
  /** Days that are not business days every year, `MM-DD` to `MM-DD` (may wrap the year). */
  shutdown: { start: string; end: string } | null;
  /** A claim must say it is made under the Act or it is not a valid payment claim (NSW, VIC). */
  actStatementRequired: boolean;
  /** NSW head contractor's claim to the principal. */
  supportingStatementRequired: boolean;
  adjudication: {
    /** Business days after the schedule is given, when it is for less than the claim. */
    scheduleLessDays: number;
    /** Business days after the due date, when the scheduled amount is unpaid. */
    unpaidDays: number;
  };
  verifiedBy: string | null;
  verifiedOn: LocalDate | null;
}

export interface DeadlineInput {
  rule: SopaRule;
  /** When the claim reached the payer's nominated service address (never the Date header). */
  servedAt: Instant;
  /** The project's IANA zone: the day of service is the local day. */
  timeZone: string;
  contractKind: ContractKind;
  /** Contract terms; shortened if the Act allows, read down to the cap if longer. */
  contractScheduleDays?: number | null;
  contractPaymentDays?: number | null;
  /** The state's public holidays for the project, including any part-state holiday that applies. */
  holidays: ReadonlySet<LocalDate>;
  /** The claim says it is made under the Act. */
  statesAct: boolean;
}

export type DeadlineResult =
  | { valid: false; reason: 'act_statement_missing'; rulesReviewed: boolean }
  | {
      valid: true;
      servedOn: LocalDate;
      scheduleDueOn: LocalDate;
      paymentDueOn: LocalDate;
      /** Set when the contract term was longer than the cap and was read down. */
      paymentReadDown: boolean;
      supportingStatementRequired: boolean;
      ruleState: SopaState;
      rulesReviewed: boolean;
    };

const monthDay = (s: string) => {
  const m = /^(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new RangeError(`Invalid month-day: ${s}`);
  return { month: Number(m[1]), day: Number(m[2]) };
};

/** Every date in the shutdown window for the years around `from`, as a holiday-style set. */
function shutdownDays(shutdown: SopaRule['shutdown'], from: LocalDate): Set<LocalDate> {
  const out = new Set<LocalDate>();
  if (!shutdown) return out;
  const start = monthDay(shutdown.start);
  const end = monthDay(shutdown.end);
  const wraps = end.month < start.month || (end.month === start.month && end.day < start.day);
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = parseLocalDate(from).year;
  for (let y = year - 1; y <= year + 2; y += 1) {
    let day = `${y}-${pad(start.month)}-${pad(start.day)}`;
    const last = `${wraps ? y + 1 : y}-${pad(end.month)}-${pad(end.day)}`;
    while (compareLocalDates(day, last) <= 0) {
      out.add(day);
      day = addDays(day, 1);
    }
  }
  return out;
}

export function sopaCalendar(
  rule: SopaRule,
  holidays: ReadonlySet<LocalDate>,
  around: LocalDate,
): BusinessDayCalendar {
  return { holidays: new Set([...holidays, ...shutdownDays(rule.shutdown, around)]) };
}

/** The earlier of the contract term and the cap; a contract term over the cap is read down. */
function periodDays(statutory: number, contract: number | null | undefined) {
  if (contract === null || contract === undefined) return { days: statutory, readDown: false };
  return contract > statutory
    ? { days: statutory, readDown: true }
    : { days: contract, readDown: false };
}

/** The rule row in force on `date`; rows must not overlap. */
export function ruleInForce(rules: readonly SopaRule[], state: SopaState, date: LocalDate) {
  return (
    rules.find(
      (r) =>
        r.state === state &&
        compareLocalDates(r.effectiveFrom, date) <= 0 &&
        (r.effectiveTo === null || compareLocalDates(date, r.effectiveTo) <= 0),
    ) ?? null
  );
}

export function computeDeadlines(input: DeadlineInput): DeadlineResult {
  const { rule } = input;
  const rulesReviewed = rule.verifiedBy !== null;
  if (rule.actStatementRequired && !input.statesAct)
    return { valid: false, reason: 'act_statement_missing', rulesReviewed };
  // The local day of service. A deeming clause that moves a late email to the next day is void (compliance/01 §4).
  const servedOn = localDateOf(input.servedAt, input.timeZone);
  const calendar = sopaCalendar(rule, input.holidays, servedOn);
  const schedule = periodDays(rule.scheduleDays, input.contractScheduleDays);
  const cap = input.contractKind === 'head' ? rule.paymentCapHead : rule.paymentCapSub;
  const payment =
    input.contractPaymentDays === null || input.contractPaymentDays === undefined
      ? { days: rule.paymentDefaultDays ?? cap, readDown: false }
      : periodDays(cap, input.contractPaymentDays);
  return {
    valid: true,
    servedOn,
    scheduleDueOn: addBusinessDays(servedOn, schedule.days, calendar),
    paymentDueOn: addBusinessDays(servedOn, payment.days, calendar),
    paymentReadDown: payment.readDown,
    supportingStatementRequired: rule.supportingStatementRequired && input.contractKind === 'head',
    ruleState: rule.state,
    rulesReviewed,
  };
}

export interface AdjudicationInput {
  rule: SopaRule;
  holidays: ReadonlySet<LocalDate>;
  /** Date the schedule was given, for a schedule for less than the claim. */
  scheduleGivenOn?: LocalDate;
  /** Payment due date, for a scheduled amount that was not paid. */
  paymentDueOn?: LocalDate;
}

/** Last day to apply for adjudication in the two scenarios with a schedule. The no-schedule path comes later. */
export function adjudicationDeadline(input: AdjudicationInput): LocalDate | null {
  const { rule } = input;
  if (input.scheduleGivenOn)
    return addBusinessDays(
      input.scheduleGivenOn,
      rule.adjudication.scheduleLessDays,
      sopaCalendar(rule, input.holidays, input.scheduleGivenOn),
    );
  if (input.paymentDueOn)
    return addBusinessDays(
      input.paymentDueOn,
      rule.adjudication.unpaidDays,
      sopaCalendar(rule, input.holidays, input.paymentDueOn),
    );
  return null;
}

const base = {
  effectiveTo: null,
  verifiedBy: null,
  verifiedOn: null,
  supportingStatementRequired: false,
} as const;

/**
 * Seed rows for the states launching first (Grace D4). Unreviewed: a construction lawyer must sign each row off
 * before the state goes live (X61). VIC's row is the one in force from 15 Apr 2026; the earlier row is not seeded.
 */
export const SOPA_RULES: readonly SopaRule[] = [
  {
    ...base,
    state: 'NSW',
    effectiveFrom: '2000-01-01',
    actName: 'Building and Construction Industry Security of Payment Act 1999',
    scheduleDays: 10,
    paymentCapHead: 15,
    paymentCapSub: 20,
    paymentDefaultDays: null,
    shutdown: { start: '12-27', end: '12-31' },
    actStatementRequired: true,
    supportingStatementRequired: true,
    adjudication: { scheduleLessDays: 10, unpaidDays: 20 },
  },
  {
    ...base,
    state: 'VIC',
    effectiveFrom: '2026-04-15',
    actName: 'Building and Construction Industry Security of Payment Act 2002',
    scheduleDays: 10,
    paymentCapHead: 20,
    paymentCapSub: 20,
    paymentDefaultDays: 10,
    shutdown: { start: '12-22', end: '01-10' },
    actStatementRequired: true,
    adjudication: { scheduleLessDays: 10, unpaidDays: 10 },
  },
  {
    ...base,
    state: 'QLD',
    effectiveFrom: '2018-12-17',
    actName: 'Building Industry Fairness (Security of Payment) Act 2017',
    scheduleDays: 15,
    paymentCapHead: 15,
    paymentCapSub: 25,
    paymentDefaultDays: 10,
    shutdown: { start: '12-22', end: '01-10' },
    actStatementRequired: false,
    adjudication: { scheduleLessDays: 30, unpaidDays: 20 },
  },
];
