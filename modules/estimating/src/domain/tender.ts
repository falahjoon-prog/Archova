// Tender package and quote rules (product/10 EST-AC1..AC7). Pure rules, no IO. Money is integer cents inside
// the rules and decimal strings at the edges, so sums never pick up float error.

export const PACKAGE_STATUSES = [
  'draft',
  'out_to_tender',
  'closed',
  'awarded',
  'cancelled',
] as const;
export type PackageStatus = (typeof PACKAGE_STATUSES)[number];

/** TP-001 */
export const formatPackageNumber = (n: number) => `TP-${String(n).padStart(3, '0')}`;

export type PackageAction = 'send' | 'close' | 'cancel' | 'reopen';

const NEXT: Record<PackageAction, { from: readonly PackageStatus[]; to: PackageStatus }> = {
  send: { from: ['draft'], to: 'out_to_tender' },
  close: { from: ['out_to_tender'], to: 'closed' },
  reopen: { from: ['closed'], to: 'out_to_tender' },
  cancel: { from: ['draft', 'out_to_tender', 'closed'], to: 'cancelled' },
};

export function nextPackageStatus(
  from: PackageStatus,
  action: PackageAction,
): PackageStatus | null {
  const rule = NEXT[action];
  return rule.from.includes(from) ? rule.to : null;
}

/** Scope, documents and invites change while the package is a draft or out to tender. */
export const isEditable = (s: PackageStatus) => s === 'draft' || s === 'out_to_tender';
/** Quotes arrive while the package is out to tender. */
export const takesQuotes = (s: PackageStatus) => s === 'out_to_tender';
/** An award is made from a package still open or just closed. */
export const canAward = (s: PackageStatus) => s === 'out_to_tender' || s === 'closed';

export const MONEY = /^-?\d{1,16}(\.\d{1,2})?$/;

/** '12.3' → 1230. Throws on anything but a decimal with at most two places. */
export function toCents(value: string): number {
  if (!MONEY.test(value)) throw new RangeError(`Not an amount: ${value}`);
  const neg = value.startsWith('-');
  const [whole, frac = ''] = value.replace('-', '').split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return neg ? -cents : cents;
}

export function fromCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * The schedule of values for a subcontract raised from a quote: one item per quote line when the lines add up to the
 * quote total (so claims can follow the quote's own breakdown), otherwise a single item for the whole price.
 */
export function subcontractSov(
  lines: readonly { description: string; amount: string }[],
  totalExGst: string,
  fallbackDescription: string,
): { code: string; description: string; value: string }[] {
  const sum = lines.reduce((n, l) => n + toCents(l.amount), 0);
  if (lines.length === 0 || sum !== toCents(totalExGst) || lines.some((l) => toCents(l.amount) < 0))
    return [
      {
        code: '1',
        description: fallbackDescription.slice(0, 300) || 'Subcontract works',
        value: fromCents(toCents(totalExGst)),
      },
    ];
  return lines.map((l, i) => ({
    code: String(i + 1),
    description: l.description.trim().slice(0, 300) || `Item ${i + 1}`,
    value: fromCents(toCents(l.amount)),
  }));
}

/** GST at 10% of an ex-GST amount, rounded half up to the cent (product/10 "ex GST"). */
export const gstOn = (exGstCents: number) => Math.round(exGstCents / 10);

/** Quote totals from line amounts, ex GST, with GST on top. */
export function quoteTotals(amounts: readonly string[]) {
  const ex = amounts.reduce((sum, a) => sum + toCents(a), 0);
  return { totalExGst: fromCents(ex), gst: fromCents(gstOn(ex)) };
}

/**
 * The cheapest of the quotes still in the running, after the estimator's allowances for gaps (EST-AC6). Quotes
 * that are superseded or declined, or not yet confirmed, don't compete.
 */
export function lowestQuote(
  quotes: ReadonlyArray<{ id: string; status: string; totalExGst: string }>,
  allowances: Readonly<Record<string, string>>,
): string | null {
  let best: { id: string; cents: number } | null = null;
  for (const q of quotes) {
    if (q.status !== 'confirmed') continue;
    const extra = Object.entries(allowances)
      .filter(([k]) => k.startsWith(`${q.id}:`))
      .reduce((sum, [, v]) => sum + toCents(v), 0);
    const cents = toCents(q.totalExGst) + extra;
    if (!best || cents < best.cents) best = { id: q.id, cents };
  }
  return best?.id ?? null;
}

/** A subcontractor sees a package only when it is out to tender or later and they were invited. */
export function canSeePackage(
  p: { status: PackageStatus },
  v: { isInternal: boolean; companyId: string | null },
  invitedCompanyIds: readonly string[],
): boolean {
  if (v.isInternal) return true;
  return p.status !== 'draft' && !!v.companyId && invitedCompanyIds.includes(v.companyId);
}
