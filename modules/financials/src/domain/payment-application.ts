import { daysBetween } from '@archova/time';
import { fromCents, percentOf, toCents } from './money';
import { percentString } from './commitment-invoices';

/** Decimal-string amounts throughout; the maths runs in whole cents. */
export interface ApplicationLineInput {
  sovItemId: string | null;
  variationId: string | null;
  previous: string;
  thisClaim: string;
  toDate: string;
}

export interface ApplicationItemInfo {
  /** Item code (SOV) or `V<number>` (variation). */
  code: string;
  description: string;
  /** The budget cost code the item is tagged to, when it is. */
  costCode?: string | null;
  /** Scheduled value (SOV item value, or the approved variation amount). */
  value: string;
  kind: 'sov' | 'variation';
}

export interface ApplicationClaimInput {
  id: string;
  number: number;
  periodEnd: string;
  receivedAt: Date;
  status: string;
  claimedGross: string;
  lessPrevious: string;
  retention: string;
  claimedNet: string;
  gst: string;
  claimedTotal: string;
  paymentDueOn: string | null;
  scheduleDueOn: string | null;
  scheduledAmount: string | null;
  paid: string;
}

export interface PriorClaimInput {
  number: number;
  periodEnd: string;
  claimedGross: string;
  lessPrevious: string;
  lines: { sovItemId: string | null; variationId: string | null; toDate: string }[];
}

export interface PaymentApplicationInput {
  contract: {
    number: number;
    title: string;
    retentionPct: string; // per cent, e.g. "5.00"
    retentionCapPct: string | null;
    originalValue: string;
  };
  /** Item info by SOV item id or variation id. */
  items: Map<string, ApplicationItemInfo>;
  /** Approved variations (all of them, claimed on this application or not) and the day each was approved. */
  approvedVariations: { amount: string; decidedOn: string | null }[];
  claim: ApplicationClaimInput;
  lines: ApplicationLineInput[];
  prior: PriorClaimInput | null;
  /** Local date (yyyy-mm-dd) in the project's time zone. */
  today: string;
}

export interface ApplicationRow {
  key: string;
  code: string;
  description: string;
  kind: 'sov' | 'variation';
  costCode: string | null;
  scheduledValue: string;
  previous: string;
  thisPeriod: string;
  completedToDate: string;
  percentComplete: string;
  balanceToFinish: string;
}

export type ProofreadSeverity = 'error' | 'warning' | 'info';

export interface ProofreadFinding {
  code: string;
  severity: ProofreadSeverity;
  message: string;
  /** The claim line the finding is about (item code), when it is about one. */
  itemCode: string | null;
}

export interface PaymentApplication {
  contractNumber: number;
  contractTitle: string;
  claimNumber: number;
  status: string;
  periodStart: string | null;
  periodEnd: string;
  receivedAt: Date;
  paymentDueOn: string | null;
  scheduleDueOn: string | null;
  summary: {
    originalSum: string;
    netChange: string;
    revisedSum: string;
    completedToDate: string;
    retainage: string;
    earnedLessRetainage: string;
    lessPrevious: string;
    thisPeriod: string;
    gst: string;
    currentPaymentDue: string;
    scheduledAmount: string | null;
    paid: string;
    balanceToFinish: string;
    percentComplete: string;
  };
  /** Change order summary (G702): approved variations before this period and in it, additions and deductions. */
  changeOrders: {
    previousAdditions: string;
    previousDeductions: string;
    thisAdditions: string;
    thisDeductions: string;
    net: string;
  };
  /** Contract retention rate, per cent. Stored material is not recorded yet, so both G702 retainage rates use it. */
  retentionPct: string;
  rows: ApplicationRow[];
  prior: { number: number; periodEnd: string; thisPeriod: string; percentComplete: string } | null;
  findings: ProofreadFinding[];
}

const nextDay = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const hundredths = (pct: string) => Math.round(Number(pct) * 100);

/** A period more than this many times the last one, and this many points of the contract, is a "big jump". */
export const JUMP_MULTIPLE = 2;
export const JUMP_POINTS = 15;
/** One item taking this many points of its own value in one claim is worth a second look. */
export const ITEM_JUMP_POINTS = 50;

const key = (l: { sovItemId: string | null; variationId: string | null }) =>
  (l.sovItemId ?? l.variationId)!;

/**
 * The payment application behind one claim: the schedule-of-values breakdown (previous, this period, to date, % complete,
 * balance), the totals, and Nova's proofread. The proofread is code, not a model: it re-adds every figure from the claim
 * lines and compares it to what the claim says, checks the dates, and flags a large step up on the last period. It only
 * reads; nothing is changed or sent from it.
 */
export function buildPaymentApplication(input: PaymentApplicationInput): PaymentApplication {
  const { claim, contract } = input;
  const rows: ApplicationRow[] = input.lines.map((l) => {
    const info = input.items.get(key(l));
    const value = toCents(info?.value ?? '0');
    const toDate = toCents(l.toDate);
    return {
      key: key(l),
      code: info?.code ?? '—',
      description: info?.description ?? 'Item no longer on the schedule of values',
      kind: info?.kind ?? 'sov',
      costCode: info?.costCode ?? null,
      scheduledValue: fromCents(value),
      previous: l.previous,
      thisPeriod: l.thisClaim,
      completedToDate: l.toDate,
      percentComplete: percentString(toDate, value),
      balanceToFinish: fromCents(value - toDate),
    };
  });
  rows.sort((a, b) =>
    a.kind === b.kind
      ? a.code.localeCompare(b.code, 'en', { numeric: true })
      : a.kind === 'sov'
        ? -1
        : 1,
  );

  const original = toCents(contract.originalValue);
  const netChange = input.approvedVariations.reduce((s, v) => s + toCents(v.amount), 0);
  const revised = original + netChange;
  const gross = toCents(claim.claimedGross);
  const lessPrevious = toCents(claim.lessPrevious);
  const thisPeriod = gross - lessPrevious;
  const payable = claim.scheduledAmount === null ? null : toCents(claim.scheduledAmount);

  const summary = {
    originalSum: fromCents(original),
    netChange: fromCents(netChange),
    revisedSum: fromCents(revised),
    completedToDate: fromCents(gross),
    retainage: claim.retention,
    earnedLessRetainage: claim.claimedNet,
    lessPrevious: fromCents(lessPrevious),
    thisPeriod: fromCents(thisPeriod),
    gst: claim.gst,
    currentPaymentDue: claim.claimedTotal,
    scheduledAmount: payable === null ? null : fromCents(payable),
    paid: claim.paid,
    balanceToFinish: fromCents(revised - gross),
    percentComplete: percentString(gross, revised),
  };

  const priorGross = input.prior ? toCents(input.prior.claimedGross) : 0;
  const priorPeriod = input.prior
    ? {
        number: input.prior.number,
        periodEnd: input.prior.periodEnd,
        thisPeriod: fromCents(priorGross - toCents(input.prior.lessPrevious)),
        percentComplete: percentString(priorGross, revised),
      }
    : null;

  return {
    contractNumber: contract.number,
    contractTitle: contract.title,
    claimNumber: claim.number,
    status: claim.status,
    periodStart: input.prior ? nextDay(input.prior.periodEnd) : null,
    periodEnd: claim.periodEnd,
    receivedAt: claim.receivedAt,
    paymentDueOn: claim.paymentDueOn,
    scheduleDueOn: claim.scheduleDueOn,
    summary,
    changeOrders: changeOrderSummary(input),
    retentionPct: contract.retentionPct,
    rows,
    prior: priorPeriod,
    findings: proofread(input, rows, { gross, lessPrevious, thisPeriod, revised }),
  };
}

function proofread(
  input: PaymentApplicationInput,
  rows: ApplicationRow[],
  t: { gross: number; lessPrevious: number; thisPeriod: number; revised: number },
): ProofreadFinding[] {
  const { claim, contract, prior } = input;
  const out: ProofreadFinding[] = [];
  const add = (
    severity: ProofreadSeverity,
    code: string,
    message: string,
    itemCode: string | null = null,
  ) => out.push({ code, severity, message, itemCode });
  const money = (cents: number) => `$${fromCents(cents)}`;

  // Amounts: the lines must add up to what the claim says.
  const lineThis = input.lines.reduce((s, l) => s + toCents(l.thisClaim), 0);
  const linePrev = input.lines.reduce((s, l) => s + toCents(l.previous), 0);
  if (lineThis !== t.thisPeriod)
    add(
      'error',
      'amounts.this_period_mismatch',
      `The lines add up to ${money(lineThis)} this period but the claim says ${money(t.thisPeriod)}.`,
    );
  if (linePrev !== t.lessPrevious)
    add(
      'error',
      'amounts.previous_mismatch',
      `The lines show ${money(linePrev)} claimed before but the claim deducts ${money(t.lessPrevious)}.`,
    );
  for (const r of rows) {
    const l = input.lines.find((x) => key(x) === r.key)!;
    if (toCents(l.previous) + toCents(l.thisClaim) !== toCents(l.toDate))
      add(
        'error',
        'amounts.line_to_date_mismatch',
        `${r.code}: previous plus this period is not the amount shown to date.`,
        r.code,
      );
    if (toCents(l.toDate) > toCents(r.scheduledValue))
      add(
        'error',
        'percent.over_100',
        `${r.code}: ${r.percentComplete}% complete is over the item's value of ${money(toCents(r.scheduledValue))}.`,
        r.code,
      );
  }

  // Retention and GST re-worked from the contract terms.
  const ret = toCents(claim.retention);
  const expectedRet = percentOf(t.thisPeriod, hundredths(contract.retentionPct));
  const cap =
    contract.retentionCapPct === null
      ? null
      : percentOf(t.revised, hundredths(contract.retentionCapPct));
  if (ret !== expectedRet && !(cap !== null && ret < expectedRet))
    add(
      'warning',
      'amounts.retention_differs',
      `Retention is ${money(ret)}; ${contract.retentionPct}% of this period is ${money(expectedRet)}.`,
    );
  const net = toCents(claim.claimedNet);
  if (net !== t.thisPeriod - ret)
    add(
      'error',
      'amounts.net_mismatch',
      'Earned less retainage does not equal this period less retention.',
    );
  const gst = toCents(claim.gst);
  if (gst !== 0 && gst !== percentOf(net, 1000))
    add(
      'warning',
      'amounts.gst_differs',
      `GST is ${money(gst)}; 10% of ${money(net)} is ${money(percentOf(net, 1000))}.`,
    );
  if (toCents(claim.claimedTotal) !== net + gst)
    add('error', 'amounts.total_mismatch', 'The total claimed is not the net amount plus GST.');

  // % complete: each item against what the last claim said, and the claim against the last period.
  if (prior) {
    const before = new Map(prior.lines.map((l) => [key(l), toCents(l.toDate)]));
    for (const r of rows) {
      const l = input.lines.find((x) => key(x) === r.key)!;
      const was = before.get(r.key) ?? 0;
      if (toCents(l.previous) !== was)
        add(
          'warning',
          'percent.previous_differs',
          `${r.code}: "previous" is ${money(toCents(l.previous))} but the last claim took it to ${money(was)}.`,
          r.code,
        );
      const value = toCents(r.scheduledValue);
      if (value > 0 && (toCents(l.thisClaim) * 100) / value >= ITEM_JUMP_POINTS && was > 0)
        add(
          'info',
          'percent.item_jump',
          `${r.code}: jumps ${percentString(toCents(l.thisClaim), value)} points this claim (${percentString(was, value)}% → ${r.percentComplete}%).`,
          r.code,
        );
    }
    if (t.gross < priorGross(prior))
      add(
        'warning',
        'percent.went_backwards',
        `Completed to date (${money(t.gross)}) is less than the last claim (${money(priorGross(prior))}).`,
      );
    const priorThis = priorGross(prior) - priorLessPrevious(prior);
    const stepPoints = (t.thisPeriod * 100) / (t.revised || 1);
    if (priorThis > 0 && t.thisPeriod >= priorThis * JUMP_MULTIPLE && stepPoints >= JUMP_POINTS)
      add(
        'warning',
        'jump.vs_prior_period',
        `This period is ${money(t.thisPeriod)}, ${(t.thisPeriod / priorThis).toFixed(1)}× the last period (${money(priorThis)}), and moves the job ${percentString(t.thisPeriod, t.revised)} points.`,
      );
  } else if (t.revised > 0 && (t.thisPeriod * 100) / t.revised >= 30) {
    add(
      'info',
      'jump.first_claim_large',
      `This first claim is ${percentString(t.thisPeriod, t.revised)}% of the contract sum.`,
    );
  }

  // Dates.
  if (claim.periodEnd > input.today)
    add(
      'warning',
      'dates.period_in_future',
      `The period ends ${claim.periodEnd}, which has not happened yet.`,
    );
  if (prior && claim.periodEnd <= prior.periodEnd)
    add(
      'error',
      'dates.period_not_after_prior',
      `The period ends ${claim.periodEnd}, not after claim ${prior.number}'s period end of ${prior.periodEnd}.`,
    );
  if (prior && daysBetween(prior.periodEnd, claim.periodEnd) > 45)
    add(
      'info',
      'dates.long_period',
      `The period covers ${daysBetween(prior.periodEnd, claim.periodEnd)} days since the last claim.`,
    );
  if (claim.receivedAt.toISOString().slice(0, 10) < claim.periodEnd)
    add(
      'warning',
      'dates.received_before_period_end',
      'The claim was made before its period ended.',
    );
  if (claim.paymentDueOn && claim.paymentDueOn < claim.periodEnd)
    add(
      'error',
      'dates.payment_due_before_period',
      'The payment due date is before the period end.',
    );

  const order = { error: 0, warning: 1, info: 2 } as const;
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

const priorGross = (p: PriorClaimInput) => toCents(p.claimedGross);
const priorLessPrevious = (p: PriorClaimInput) => toCents(p.lessPrevious);

function changeOrderSummary(input: PaymentApplicationInput): PaymentApplication['changeOrders'] {
  const cutoff = input.prior?.periodEnd ?? null;
  let pa = 0;
  let pd = 0;
  let ta = 0;
  let td = 0;
  for (const v of input.approvedVariations) {
    const amt = toCents(v.amount);
    const before = cutoff !== null && v.decidedOn !== null && v.decidedOn <= cutoff;
    if (before) {
      if (amt >= 0) pa += amt;
      else pd += -amt;
    } else if (amt >= 0) ta += amt;
    else td += -amt;
  }
  return {
    previousAdditions: fromCents(pa),
    previousDeductions: fromCents(pd),
    thisAdditions: fromCents(ta),
    thisDeductions: fromCents(td),
    net: fromCents(pa - pd + ta - td),
  };
}

/**
 * Nova's check of the architect's certified amount against the current payment due. Anything different is for a
 * person to look at before the application goes out; the certified amount is whatever they typed in, nothing is changed.
 */
export function certifiedAmountFinding(
  currentPaymentDue: string,
  amountCertified: string,
): ProofreadFinding | null {
  const due = toCents(currentPaymentDue);
  const certified = toCents(amountCertified);
  if (due === certified) return null;
  const diff = certified - due;
  return {
    code: 'certificate.amount_differs',
    severity: 'warning',
    itemCode: null,
    message: `The amount certified (${fromCents(certified)}) is ${fromCents(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} than the amount applied for (${fromCents(due)}). Review before sending.`,
  };
}
