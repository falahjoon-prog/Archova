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

/** East-coast model states with a rule row. NT uses the west-coast model (payment disputes) and is not built yet (D4). */
export type SopaState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT';
export type ContractKind = 'head' | 'subcontract';

/**
 * `notice`: the claimant serves a notice of intention to apply; the respondent then has `respondentDays` to give a
 * schedule; the claimant applies within `applyWithinDays` after that. The notice itself must be served within
 * `noticeWithinDays` after the payment due date. `direct`: QLD, one window after the later of the payment due date
 * and the last day for a schedule.
 */
export type NoScheduleRule =
  | { kind: 'notice'; noticeWithinDays: number; respondentDays: number; applyWithinDays: number }
  | { kind: 'direct'; applyWithinDays: number };

export interface SopaRule {
  state: SopaState;
  effectiveFrom: LocalDate;
  effectiveTo: LocalDate | null;
  actName: string;
  /** Business days the respondent has to give a payment schedule. */
  scheduleDays: number;
  /** TAS: schedule period where the respondent is a non-practitioner owner of a residential structure. */
  scheduleDaysResidentialOwner?: number;
  /** Caps on the payment period; the contract may shorten, never extend. Null: the Act sets no cap (SA, TAS). */
  paymentCapHead: number | null;
  paymentCapSub: number | null;
  /** Payment period when the contract is silent; null means the cap (compliance/02 N3 reads NSW that way). */
  paymentDefaultDays: number | null;
  /** TAS: payment default for a residential owner respondent. */
  paymentDefaultDaysResidentialOwner?: number;
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
    /** What the claimant may do when no schedule was given by the due date (compliance/01 §2). */
    noSchedule: NoScheduleRule;
    /**
     * The respondent's response to an adjudication application (compliance/01b). Due on the later of
     * `afterApplicationDays` business days after receiving the application and, where the Act has the limb,
     * `afterAcceptanceDays` after receiving notice of the adjudicator's acceptance. Standard (not complex) claims.
     */
    response: { afterApplicationDays: number; afterAcceptanceDays: number | null };
    /** Business days the adjudicator has to decide. The clock start is a lawyer question for NSW and QLD (⚖). */
    decisionDays: number;
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
  /** TAS: the respondent is a non-practitioner owner of a residential structure (longer periods). */
  residentialOwner?: boolean;
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
  const owner = input.residentialOwner === true;
  const schedule = periodDays(
    owner ? (rule.scheduleDaysResidentialOwner ?? rule.scheduleDays) : rule.scheduleDays,
    input.contractScheduleDays,
  );
  const cap = input.contractKind === 'head' ? rule.paymentCapHead : rule.paymentCapSub;
  const defaultDays = owner
    ? (rule.paymentDefaultDaysResidentialOwner ?? rule.paymentDefaultDays)
    : rule.paymentDefaultDays;
  const payment =
    input.contractPaymentDays === null || input.contractPaymentDays === undefined
      ? { days: defaultDays ?? cap ?? rule.scheduleDays, readDown: false }
      : cap === null
        ? { days: input.contractPaymentDays, readDown: false }
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

/** Last day to apply for adjudication in the two scenarios with a schedule. The no-schedule path is below. */
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

export interface ResponseDueInput {
  rule: SopaRule;
  holidays: ReadonlySet<LocalDate>;
  /** The day the respondent received the application. */
  applicationReceivedOn: LocalDate;
  /** The day the respondent received notice of the adjudicator's acceptance, once known. */
  acceptanceReceivedOn?: LocalDate | null;
}

/**
 * The respondent's last day to respond (compliance/01b): the later of the two limbs the Act has. With no acceptance
 * notice yet, only the application limb is known, so the result is a floor that can move later (`final: false`).
 * Standard claims only: the longer complex-claim periods are not modelled.
 */
export function responseDue(input: ResponseDueInput): { dueOn: LocalDate; final: boolean } {
  const { rule } = input;
  const r = rule.adjudication.response;
  const days = (from: LocalDate, n: number) =>
    addBusinessDays(from, n, sopaCalendar(rule, input.holidays, from));
  const app = days(input.applicationReceivedOn, r.afterApplicationDays);
  if (r.afterAcceptanceDays === null) return { dueOn: app, final: true };
  if (!input.acceptanceReceivedOn) return { dueOn: app, final: false };
  const acc = days(input.acceptanceReceivedOn, r.afterAcceptanceDays);
  return { dueOn: compareLocalDates(acc, app) > 0 ? acc : app, final: true };
}

/** The adjudicator's last day to decide: `decisionDays` business days from `from` (the response lodged or due day). */
export function decisionDue(
  rule: SopaRule,
  holidays: ReadonlySet<LocalDate>,
  from: LocalDate,
): LocalDate {
  return addBusinessDays(from, rule.adjudication.decisionDays, sopaCalendar(rule, holidays, from));
}

export interface NoScheduleInput {
  rule: SopaRule;
  holidays: ReadonlySet<LocalDate>;
  /** The claim's payment due date and the last day the respondent had to give a schedule. */
  paymentDueOn: LocalDate;
  scheduleDueOn: LocalDate;
  /** The day the claimant served the notice of intention to apply (notice states only). */
  noticeServedOn?: LocalDate;
}

export type NoScheduleResult =
  | {
      kind: 'direct';
      /** Last day to apply for adjudication. */
      applyBy: LocalDate;
    }
  | {
      kind: 'notice';
      /** Last day the claimant can serve the notice of intention. */
      noticeBy: LocalDate;
      /** Once the notice is served: the respondent's last day to give a schedule, and the last day to apply. */
      respondentBy: LocalDate | null;
      applyBy: LocalDate | null;
    };

/** Adjudication path when no payment schedule was given in time (N13, Q11). */
export function noScheduleAdjudication(input: NoScheduleInput): NoScheduleResult {
  const { rule } = input;
  const path = rule.adjudication.noSchedule;
  if (path.kind === 'direct') {
    const from =
      compareLocalDates(input.paymentDueOn, input.scheduleDueOn) >= 0
        ? input.paymentDueOn
        : input.scheduleDueOn;
    return {
      kind: 'direct',
      applyBy: addBusinessDays(
        from,
        path.applyWithinDays,
        sopaCalendar(rule, input.holidays, from),
      ),
    };
  }
  const cal = (d: LocalDate) => sopaCalendar(rule, input.holidays, d);
  const noticeBy = addBusinessDays(
    input.paymentDueOn,
    path.noticeWithinDays,
    cal(input.paymentDueOn),
  );
  if (!input.noticeServedOn) return { kind: 'notice', noticeBy, respondentBy: null, applyBy: null };
  const respondentBy = addBusinessDays(
    input.noticeServedOn,
    path.respondentDays,
    cal(input.noticeServedOn),
  );
  return {
    kind: 'notice',
    noticeBy,
    respondentBy,
    applyBy: addBusinessDays(respondentBy, path.applyWithinDays, cal(respondentBy)),
  };
}

const base = {
  effectiveTo: null,
  verifiedBy: null,
  verifiedOn: null,
  supportingStatementRequired: false,
} as const;

/**
 * Seed rows for the east-coast model states (Grace compliance/01 §2, 02 §4). NT is west-coast and not seeded.
 * Unreviewed: a construction lawyer must sign each row off before the state goes live (X61). VIC's row is the one in
 * force from 15 Apr 2026; the earlier row is not seeded. Windows marked ⚖ in compliance/01 are Grace's best reading.
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
    adjudication: {
      scheduleLessDays: 10,
      unpaidDays: 20,
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 10 },
      response: { afterApplicationDays: 5, afterAcceptanceDays: 2 },
      decisionDays: 10,
    },
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
    adjudication: {
      scheduleLessDays: 10,
      unpaidDays: 10,
      // ⚖ the notice window and the respondent's 5 BD are not confirmed for VIC.
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 10 },
      response: { afterApplicationDays: 5, afterAcceptanceDays: null },
      decisionDays: 10,
    },
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
    adjudication: {
      scheduleLessDays: 30,
      unpaidDays: 20,
      noSchedule: { kind: 'direct', applyWithinDays: 30 },
      response: { afterApplicationDays: 10, afterAcceptanceDays: 7 },
      decisionDays: 10,
    },
  },
  {
    ...base,
    state: 'WA',
    effectiveFrom: '2022-08-01',
    actName: 'Building and Construction Industry (Security of Payment) Act 2021',
    scheduleDays: 15,
    paymentCapHead: 20,
    paymentCapSub: 25,
    paymentDefaultDays: null,
    shutdown: { start: '12-22', end: '01-10' },
    actStatementRequired: true,
    adjudication: {
      scheduleLessDays: 20,
      unpaidDays: 20,
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 20 },
      response: { afterApplicationDays: 10, afterAcceptanceDays: null },
      decisionDays: 10,
    },
  },
  {
    ...base,
    state: 'SA',
    effectiveFrom: '2011-12-10',
    actName: 'Building and Construction Industry Security of Payment Act 2009',
    scheduleDays: 15,
    paymentCapHead: null,
    paymentCapSub: null,
    paymentDefaultDays: 15,
    shutdown: { start: '12-27', end: '12-31' },
    actStatementRequired: true,
    adjudication: {
      scheduleLessDays: 15,
      unpaidDays: 20,
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 15 },
      response: { afterApplicationDays: 5, afterAcceptanceDays: 2 },
      decisionDays: 10,
    },
  },
  {
    ...base,
    state: 'TAS',
    effectiveFrom: '2009-12-01',
    actName: 'Building and Construction Industry Security of Payment Act 2009',
    scheduleDays: 10,
    scheduleDaysResidentialOwner: 20,
    paymentCapHead: null,
    paymentCapSub: null,
    paymentDefaultDays: 10,
    paymentDefaultDaysResidentialOwner: 20,
    shutdown: { start: '12-27', end: '12-31' },
    actStatementRequired: true,
    adjudication: {
      scheduleLessDays: 10,
      unpaidDays: 20,
      // ⚖ the apply window after the respondent's 5 BD is not confirmed for TAS.
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 10 },
      response: { afterApplicationDays: 10, afterAcceptanceDays: 5 },
      decisionDays: 10,
    },
  },
  {
    ...base,
    state: 'ACT',
    effectiveFrom: '2009-12-01',
    actName: 'Building and Construction Industry (Security of Payment) Act 2009',
    scheduleDays: 10,
    paymentCapHead: 15,
    paymentCapSub: 15,
    paymentDefaultDays: 15,
    shutdown: { start: '12-27', end: '12-31' },
    actStatementRequired: true,
    adjudication: {
      scheduleLessDays: 10,
      unpaidDays: 20,
      // ⚖ ACT no-schedule notice timing is unconfirmed.
      noSchedule: { kind: 'notice', noticeWithinDays: 20, respondentDays: 5, applyWithinDays: 10 },
      response: { afterApplicationDays: 7, afterAcceptanceDays: 5 },
      decisionDays: 10,
    },
  },
];
