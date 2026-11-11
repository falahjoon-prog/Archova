import { fromCents, toCents } from './money';

/** What the Invoices tab needs from one payment claim on the commitment's contract (amounts are decimal strings). */
export interface InvoiceClaimInput {
  id: string;
  number: number;
  periodEnd: string; // yyyy-mm-dd
  receivedAt: Date;
  status: string;
  claimedGross: string; // completed to date, ex GST
  lessPrevious: string;
  retention: string;
  claimedNet: string;
  scheduledAmount: string | null;
  paid: string;
  paymentDueOn: string | null;
}

export interface InvoiceRow {
  claimId: string;
  number: number;
  periodStart: string | null;
  periodEnd: string;
  receivedAt: Date;
  status: string;
  thisPeriod: string;
  completedToDate: string;
  retainage: string;
  earnedLessRetainage: string;
  payable: string;
  paid: string;
  paymentDue: string;
  paymentDueOn: string | null;
  balanceToFinish: string;
  /** Completed to date against the revised contract sum, in per cent to 2 decimal places. */
  percentComplete: string;
}

export interface InvoiceSummary {
  originalSum: string;
  netChange: string;
  revisedSum: string;
  invoiced: string;
  retainage: string;
  paid: string;
  remaining: string;
  percentPaid: string;
  rows: InvoiceRow[];
}

const nextDay = (iso: string) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Per cent to two decimals from two cent amounts; zero when there is nothing to divide by. */
export function percentString(partCents: number, wholeCents: number): string {
  if (wholeCents <= 0) return '0.00';
  const hundredths = Math.round((partCents * 10_000) / wholeCents);
  return `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/**
 * The commitment's billing position from its contract's claims: contract sum (original plus approved variations),
 * one row per claim in claim order, and totals. Withdrawn claims are listed but do not count as invoiced.
 */
export function summariseInvoices(input: {
  originalValue: string;
  approvedVariations: string[];
  claims: InvoiceClaimInput[];
}): InvoiceSummary {
  const original = toCents(input.originalValue);
  const netChange = input.approvedVariations.reduce((s, v) => s + toCents(v), 0);
  const revised = original + netChange;
  const ordered = [...input.claims].sort((a, b) => a.number - b.number);
  let prevEnd: string | null = null;
  let invoiced = 0;
  let retainage = 0;
  let paid = 0;
  let payableTotal = 0;
  const rows: InvoiceRow[] = ordered.map((c) => {
    const gross = toCents(c.claimedGross);
    const net = toCents(c.claimedNet);
    const payable = c.scheduledAmount === null ? net : toCents(c.scheduledAmount);
    const paidCents = toCents(c.paid);
    const counts = c.status !== 'withdrawn';
    if (counts) {
      invoiced = Math.max(invoiced, gross);
      retainage += toCents(c.retention);
      paid += paidCents;
      payableTotal += payable;
    }
    const row: InvoiceRow = {
      claimId: c.id,
      number: c.number,
      periodStart: prevEnd ? nextDay(prevEnd) : null,
      periodEnd: c.periodEnd,
      receivedAt: c.receivedAt,
      status: c.status,
      thisPeriod: fromCents(gross - toCents(c.lessPrevious)),
      completedToDate: fromCents(gross),
      retainage: c.retention,
      earnedLessRetainage: c.claimedNet,
      payable: fromCents(payable),
      paid: fromCents(paidCents),
      paymentDue: fromCents(Math.max(0, payable - paidCents)),
      paymentDueOn: c.paymentDueOn,
      balanceToFinish: fromCents(revised - gross),
      percentComplete: percentString(gross, revised),
    };
    if (counts) prevEnd = c.periodEnd;
    return row;
  });
  return {
    originalSum: fromCents(original),
    netChange: fromCents(netChange),
    revisedSum: fromCents(revised),
    invoiced: fromCents(invoiced),
    retainage: fromCents(retainage),
    paid: fromCents(paid),
    remaining: fromCents(Math.max(0, payableTotal - paid)),
    percentPaid: percentString(paid, payableTotal),
    rows,
  };
}
