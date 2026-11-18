// Cashflow and work-in-progress (WIP) forecast for one project. Pure, no IO; all maths in whole cents, ex GST, and
// the caller says what "today" is. Code works out every figure and finds every risk; Nova only explains them.
//
// Cash in: head-contract claims paid, claims still waiting on the client (at their due date), then the unbilled
// balance of the contract billed along the monthly cost forecast and paid after the head contract's payment terms,
// less retention, and retention released at practical completion and at the end of the defects period.
// Cash out: subcontract claims paid and direct costs, open subcontract claims at their due date, then the monthly
// cost forecast paid after the subcontract payment lag.
// WIP: cost-to-cost percent complete, earned revenue, and billed against earned (over or under billing).

import { addDays } from '@archova/time';

export type Month = string; // YYYY-MM

export interface CashClaim {
  /** Whole-dollar claim number, for messages. */
  number: number;
  status: string;
  /** Claimed ex GST, after retention. */
  netCents: number;
  retentionCents: number;
  /** Month of the last payment when the claim is paid. */
  paidMonth: Month | null;
  /** Statutory payment due date (YYYY-MM-DD), when set. */
  dueOn: string | null;
  periodEnd: string;
}

export interface HeadTerms {
  revenueCents: number;
  billedGrossCents: number;
  retentionPct: number;
  retentionCapPct: number | null;
  /** Payment terms in days, for forecasting when future claims are paid. */
  paymentDays: number;
  retentionReleasedCents: number;
  pcReleased: boolean;
  practicalCompletionOn: string | null;
  defectsPeriodDays: number | null;
  firstReleasePct: number;
}

export interface CashflowInput {
  today: string;
  head: HeadTerms | null;
  headClaims: readonly CashClaim[];
  subClaims: readonly CashClaim[];
  /** Direct costs recorded, by the month they were incurred. */
  directCosts: ReadonlyArray<{ month: Month; cents: number }>;
  /** The team's monthly cost plan (budget forecast), all months. */
  costPlan: ReadonlyArray<{ month: Month; cents: number }>;
  /** Projected cost not yet placed in a month. */
  unscheduledCostCents: number;
  /** Subcontract and supplier payment lag in whole months. */
  payLagMonths: number;
  /** From the cost forecast. */
  costToDateCents: number;
  estimatedFinalCostCents: number;
}

export type MonthKind = 'actual' | 'current' | 'forecast';

export interface CashMonth {
  month: Month;
  kind: MonthKind;
  cashInCents: number;
  cashOutCents: number;
  netCents: number;
  cumulativeCents: number;
}

export type FlagCode =
  | 'cash_gap'
  | 'negative_cash_now'
  | 'underbilled'
  | 'overbilled'
  | 'overdue_receivable'
  | 'disputed_claims'
  | 'loss_making'
  | 'no_cost_plan'
  | 'unscheduled_cost'
  | 'retention_no_date'
  | 'no_head_contract';

export interface CashFlag {
  code: FlagCode;
  severity: 'info' | 'warn' | 'risk';
  title: string;
  detail: string;
  month?: Month;
  amountCents?: number;
}

export interface Wip {
  contractValueCents: number;
  estimatedFinalCostCents: number;
  costToDateCents: number;
  /** Hundredths of a percent (cost to date over estimated final cost), 0 to 10000. */
  percentCompleteHundredths: number;
  earnedRevenueCents: number;
  billedCents: number;
  /** Billed minus earned: positive is overbilled, negative is underbilled. */
  overUnderBilledCents: number;
  earnedGrossProfitCents: number;
  projectedGrossProfitCents: number;
  receivableOpenCents: number;
  retentionHeldCents: number;
}

export interface CashflowResult {
  months: CashMonth[];
  wip: Wip | null;
  flags: CashFlag[];
  totals: {
    cashInToDateCents: number;
    cashOutToDateCents: number;
    forecastCashInCents: number;
    forecastCashOutCents: number;
    lowestCumulativeCents: number;
    lowestMonth: Month | null;
  };
}

const MAX_MONTHS = 36;
const money = (c: number) => {
  const abs = Math.abs(c);
  const s = `$${Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
  return c < 0 ? `-${s}` : s;
};
const monthOf = (date: string): Month => date.slice(0, 7);

export function addMonths(month: Month, n: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

const OPEN = ['submitted', 'scheduled'] as const;
const IN_DISPUTE = ['disputed', 'adjudication'] as const;

export function computeCashflow(input: CashflowInput): CashflowResult {
  const thisMonth = monthOf(input.today);
  const inM = new Map<Month, number>();
  const outM = new Map<Month, number>();
  const add = (m: Map<Month, number>, month: Month, cents: number) => {
    if (cents !== 0) m.set(month, (m.get(month) ?? 0) + cents);
  };
  /** A payment expected in the past still has not arrived: it lands this month. */
  const due = (c: CashClaim, termsDays: number) => {
    const date = c.dueOn ?? addDays(c.periodEnd, termsDays);
    const m = monthOf(date);
    return m < thisMonth ? thisMonth : m;
  };

  const flags: CashFlag[] = [];
  let inToDate = 0;
  let outToDate = 0;

  // Money already moved.
  for (const c of input.headClaims)
    if (c.status === 'paid' && c.paidMonth) {
      add(inM, c.paidMonth, c.netCents);
      inToDate += c.netCents;
    }
  for (const c of input.subClaims)
    if (c.status === 'paid' && c.paidMonth) {
      add(outM, c.paidMonth, c.netCents);
      outToDate += c.netCents;
    }
  for (const d of input.directCosts) {
    add(outM, d.month, d.cents);
    outToDate += d.cents;
  }

  // Claims waiting on a payment.
  const headDays = input.head?.paymentDays ?? 30;
  const openHead = input.headClaims.filter((c) => (OPEN as readonly string[]).includes(c.status));
  for (const c of openHead) add(inM, due(c, headDays), c.netCents);
  const openSub = input.subClaims.filter((c) => (OPEN as readonly string[]).includes(c.status));
  for (const c of openSub) add(outM, due(c, input.payLagMonths * 30), c.netCents);
  const receivableOpen = openHead.reduce((n, c) => n + c.netCents, 0);

  const overdue = openHead.filter((c) => c.dueOn !== null && c.dueOn < input.today);
  if (overdue.length) {
    const sum = overdue.reduce((n, c) => n + c.netCents, 0);
    flags.push({
      code: 'overdue_receivable',
      severity: 'risk',
      title: `${overdue.length} claim${overdue.length === 1 ? '' : 's'} to the client overdue`,
      detail: `${money(sum)} was due on or before ${[...overdue.map((c) => c.dueOn as string)].sort().reverse()[0]} and has not been paid. Chase it, and check the SOPA payment schedule dates.`,
      amountCents: sum,
    });
  }
  const disputed = input.headClaims.filter((c) =>
    (IN_DISPUTE as readonly string[]).includes(c.status),
  );
  if (disputed.length) {
    const sum = disputed.reduce((n, c) => n + c.netCents, 0);
    flags.push({
      code: 'disputed_claims',
      severity: 'warn',
      title: `${money(sum)} of client claims in dispute`,
      detail:
        'Disputed and adjudication claims are left out of the cash forecast until they are resolved.',
      amountCents: sum,
    });
  }

  // Future billing, along the cost plan.
  const plan = input.costPlan.filter((p) => p.month >= thisMonth && p.cents > 0);
  const planTotal = plan.reduce((n, p) => n + p.cents, 0);
  const retentionHeld = input.headClaims
    .filter((c) => c.status !== 'withdrawn')
    .reduce((n, c) => n + c.retentionCents, 0);
  const head = input.head;
  let retentionEver = retentionHeld;
  if (head) {
    const remaining = Math.max(head.revenueCents - head.billedGrossCents, 0);
    if (remaining > 0 && planTotal > 0) {
      const lag = Math.max(Math.round(head.paymentDays / 30), 0);
      const cap =
        head.retentionCapPct === null
          ? Number.POSITIVE_INFINITY
          : Math.round((head.revenueCents * head.retentionCapPct) / 100);
      let placed = 0;
      plan.forEach((p, i) => {
        const gross =
          i === plan.length - 1
            ? remaining - placed
            : Math.round((remaining * p.cents) / planTotal);
        placed += gross;
        const retained = Math.min(
          Math.round((gross * head.retentionPct) / 100),
          Math.max(cap - retentionEver, 0),
        );
        retentionEver += retained;
        add(inM, addMonths(p.month, lag), gross - retained);
      });
    }
    // Retention coming back.
    const pending = Math.max(retentionEver - head.retentionReleasedCents, 0);
    if (pending > 0) {
      const first = head.pcReleased
        ? 0
        : Math.min(pending, Math.round((retentionEver * head.firstReleasePct) / 100));
      const last = pending - first;
      const pc = head.practicalCompletionOn;
      const end =
        pc !== null && head.defectsPeriodDays !== null ? addDays(pc, head.defectsPeriodDays) : null;
      const at = (d: string) => (monthOf(d) < thisMonth ? thisMonth : monthOf(d));
      let undated = 0;
      if (first > 0) {
        if (pc) add(inM, at(pc), first);
        else undated += first;
      }
      if (last > 0) {
        if (end) add(inM, at(end), last);
        else undated += last;
      }
      if (undated > 0)
        flags.push({
          code: 'retention_no_date',
          severity: 'info',
          title: `${money(undated)} of retention has no release date`,
          detail:
            'Set practical completion and the defects period on the head contract and the release lands in the cash forecast.',
          amountCents: undated,
        });
    }
  } else {
    flags.push({
      code: 'no_head_contract',
      severity: 'info',
      title: 'No head contract yet',
      detail:
        'Add the head contract and its schedule of values to forecast cash in and the WIP position.',
    });
  }

  // Future cost.
  if (plan.length === 0)
    flags.push({
      code: 'no_cost_plan',
      severity: 'warn',
      title: 'No monthly cost forecast',
      detail:
        'Add monthly amounts under Budget, Forecasting. Until then only claims already received are in the cash forecast.',
    });
  for (const p of plan) add(outM, addMonths(p.month, input.payLagMonths), p.cents);
  if (input.unscheduledCostCents > 0 && plan.length > 0)
    flags.push({
      code: 'unscheduled_cost',
      severity: 'warn',
      title: `${money(input.unscheduledCostCents)} of projected cost is not placed in a month`,
      detail:
        'The cash forecast understates cash out by that amount until it is spread across months.',
      amountCents: input.unscheduledCostCents,
    });

  // Month rows, from the first month with any money to the last.
  const keys = [...new Set([...inM.keys(), ...outM.keys(), thisMonth])].sort();
  const first = keys[0] as Month;
  const last = keys[keys.length - 1] as Month;
  const months: CashMonth[] = [];
  let running = 0;
  for (let m = first; m <= last && months.length < MAX_MONTHS; m = addMonths(m, 1)) {
    const cashIn = inM.get(m) ?? 0;
    const cashOut = outM.get(m) ?? 0;
    running += cashIn - cashOut;
    months.push({
      month: m,
      kind: m < thisMonth ? 'actual' : m === thisMonth ? 'current' : 'forecast',
      cashInCents: cashIn,
      cashOutCents: cashOut,
      netCents: cashIn - cashOut,
      cumulativeCents: running,
    });
  }

  const lowest = months.reduce<CashMonth | null>(
    (lo, m) => (lo === null || m.cumulativeCents < lo.cumulativeCents ? m : lo),
    null,
  );
  const now = months.find((m) => m.kind === 'current');
  if (now && now.cumulativeCents < 0)
    flags.push({
      code: 'negative_cash_now',
      severity: 'warn',
      title: `The job is ${money(-now.cumulativeCents)} cash negative`,
      detail:
        'You have paid out more than the client has paid in, so the job is being funded from other cash. Claim what is unbilled.',
      month: now.month,
      amountCents: -now.cumulativeCents,
    });
  const gap = months.find((m) => m.kind === 'forecast' && m.cumulativeCents < 0);
  if (
    gap &&
    lowest &&
    lowest.cumulativeCents < 0 &&
    lowest.kind !== 'actual' &&
    (now?.cumulativeCents ?? 0) >= 0
  )
    flags.push({
      code: 'cash_gap',
      severity: 'risk',
      title: `Cash gap from ${gap.month}, deepest ${money(-lowest.cumulativeCents)} in ${lowest.month}`,
      detail:
        'On the current claim, payment and cost forecasts the job runs out of its own cash. Bring claims forward, ease subcontractor timing or plan the funding.',
      month: lowest.month,
      amountCents: -lowest.cumulativeCents,
    });

  // WIP.
  let wip: Wip | null = null;
  if (head && head.revenueCents > 0) {
    const est = Math.max(input.estimatedFinalCostCents, input.costToDateCents);
    const pct = est > 0 ? Math.min(Math.round((input.costToDateCents * 10_000) / est), 10_000) : 0;
    const earned = Math.round((head.revenueCents * pct) / 10_000);
    const over = head.billedGrossCents - earned;
    wip = {
      contractValueCents: head.revenueCents,
      estimatedFinalCostCents: est,
      costToDateCents: input.costToDateCents,
      percentCompleteHundredths: pct,
      earnedRevenueCents: earned,
      billedCents: head.billedGrossCents,
      overUnderBilledCents: over,
      earnedGrossProfitCents: earned - input.costToDateCents,
      projectedGrossProfitCents: head.revenueCents - est,
      receivableOpenCents: receivableOpen,
      retentionHeldCents: Math.max(retentionHeld - head.retentionReleasedCents, 0),
    };
    const threshold = Math.max(Math.round(head.revenueCents / 100), 100_000);
    if (est > 0 && over <= -threshold)
      flags.push({
        code: 'underbilled',
        severity: -over >= head.revenueCents / 10 ? 'risk' : 'warn',
        title: `Underbilled by ${money(-over)}`,
        detail: `Cost to date says the job is ${(pct / 100).toFixed(1)}% complete (${money(earned)} earned) but only ${money(head.billedGrossCents)} has been claimed. Claim the difference to bring cash forward.`,
        amountCents: -over,
      });
    if (est > 0 && over >= threshold)
      flags.push({
        code: 'overbilled',
        severity: over >= head.revenueCents / 10 ? 'warn' : 'info',
        title: `Overbilled by ${money(over)}`,
        detail: `${money(head.billedGrossCents)} has been claimed against ${money(earned)} earned (${(pct / 100).toFixed(1)}% complete). That cash is borrowed from later in the job, so check the remaining cost is still covered.`,
        amountCents: over,
      });
    if (head.revenueCents - est < 0)
      flags.push({
        code: 'loss_making',
        severity: 'risk',
        title: `Forecast loss of ${money(est - head.revenueCents)}`,
        detail:
          'Estimated final cost is above the contract value. Recognise the whole loss now rather than as the job completes.',
        amountCents: est - head.revenueCents,
      });
  }

  const order = { risk: 0, warn: 1, info: 2 } as const;
  flags.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    months,
    wip,
    flags,
    totals: {
      cashInToDateCents: inToDate,
      cashOutToDateCents: outToDate,
      forecastCashInCents: months
        .filter((m) => m.kind !== 'actual')
        .reduce((n, m) => n + m.cashInCents, 0),
      forecastCashOutCents: months
        .filter((m) => m.kind !== 'actual')
        .reduce((n, m) => n + m.cashOutCents, 0),
      lowestCumulativeCents: lowest?.cumulativeCents ?? 0,
      lowestMonth: lowest?.month ?? null,
    },
  };
}
