import type { CommitmentInvoice } from '../data/api';

const BOM = String.fromCharCode(0xfeff);

const HEADER = [
  'Invoice #',
  'Period start',
  'Period end',
  'Received',
  'Status',
  'This period',
  'Completed to date',
  'Retainage',
  'Earned less retainage',
  'Payable',
  'Paid',
  'Payment due',
  'Payment due on',
  'Balance to finish',
  '% complete',
] as const;

/** RFC 4180 quoting; text a spreadsheet would run as a formula gets a leading apostrophe. */
function cell(value: string | number | null): string {
  if (value === null) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The Invoices table as CSV (UTF-8 with a byte-order mark so Excel reads it, CRLF line ends). */
export function invoicesToCsv(rows: readonly CommitmentInvoice[]): string {
  const lines = rows.map((r) =>
    [
      r.number,
      r.periodStart,
      r.periodEnd,
      r.receivedAt.slice(0, 10),
      r.status,
      r.thisPeriod,
      r.completedToDate,
      r.retainage,
      r.earnedLessRetainage,
      r.payable,
      r.paid,
      r.paymentDue,
      r.paymentDueOn,
      r.balanceToFinish,
      r.percentComplete,
    ]
      .map(cell)
      .join(','),
  );
  return `${BOM}${[HEADER.join(','), ...lines].join('\r\n')}\r\n`;
}
