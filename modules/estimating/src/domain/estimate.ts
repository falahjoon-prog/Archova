// Estimate sheet arithmetic (product/10 EST-US11). Plain, editable calculation: quantity × rate per line, then
// contingency, margin and GST as percentages the estimator sets. Nothing here is priced or decided by Nova, and a
// line without a rate has no amount: it is counted as missing, never filled in.
//
// Money is held as whole cents and quantities as thousandths in BigInt, so a total is exact and the same everywhere.
// Percentages are in hundredths of a percent (basis points). Every division rounds half up.

export interface SheetLine {
  id: string;
  parentId: string | null;
  kind: 'section' | 'item';
  quantity: string | null;
  rate: string | null;
}

export interface SheetSettings {
  contingencyPct: string;
  marginPct: string;
  /** `markup` adds the margin on top of cost; `margin` is a share of the selling price. */
  marginBasis: 'markup' | 'margin';
  gstPct: string;
}

export interface SheetTotals {
  /** Amount per priced item, ex GST. Items without a quantity or rate are absent. */
  amounts: Record<string, string>;
  /** Cost of the items under each section, keyed by section id. */
  sections: Record<string, string>;
  missingRates: number;
  subtotal: string;
  contingency: string;
  margin: string;
  totalExGst: string;
  gst: string;
  totalIncGst: string;
}

/** "12.345" → 12345n at the given number of decimal places; null when it is not a plain non-negative decimal. */
export function scaled(value: string, places: number): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > places && /[1-9]/.test(frac.slice(places))) return null;
  return BigInt(m[1]! + frac.slice(0, places).padEnd(places, '0'));
}

const divRound = (n: bigint, d: bigint) => (n * 2n + d) / (d * 2n);

export function formatCents(cents: bigint): string {
  const whole = cents / 100n;
  const frac = (cents % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

/** quantity (3 places) × rate (2 places) as cents, or null when either is missing. */
export function lineAmountCents(quantity: string | null, rate: string | null): bigint | null {
  if (quantity === null || rate === null) return null;
  const q = scaled(quantity, 3);
  const r = scaled(rate, 2);
  if (q === null || r === null) return null;
  return divRound(q * r, 1000n);
}

const bp = (pct: string) => scaled(pct, 2) ?? 0n;

export function computeSheet(lines: readonly SheetLine[], s: SheetSettings): SheetTotals {
  const amounts: Record<string, string> = {};
  const sections: Record<string, bigint> = {};
  let subtotal = 0n;
  let missingRates = 0;
  for (const line of lines) {
    if (line.kind === 'section') {
      sections[line.id] = 0n;
      continue;
    }
    const cents = lineAmountCents(line.quantity, line.rate);
    if (cents === null) {
      missingRates += 1;
      continue;
    }
    amounts[line.id] = formatCents(cents);
    subtotal += cents;
    if (line.parentId && line.parentId in sections) sections[line.parentId]! += cents;
  }
  const contingency = divRound(subtotal * bp(s.contingencyPct), 10000n);
  const base = subtotal + contingency;
  const m = bp(s.marginPct);
  const margin =
    s.marginBasis === 'margin' && m < 10000n
      ? divRound(base * m, 10000n - m)
      : divRound(base * m, 10000n);
  const totalExGst = base + margin;
  const gst = divRound(totalExGst * bp(s.gstPct), 10000n);
  return {
    amounts,
    sections: Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, formatCents(v)])),
    missingRates,
    subtotal: formatCents(subtotal),
    contingency: formatCents(contingency),
    margin: formatCents(margin),
    totalExGst: formatCents(totalExGst),
    gst: formatCents(gst),
    totalIncGst: formatCents(totalExGst + gst),
  };
}

/** Thousandths summed back to a 3 place decimal string. */
export function sumQuantities(values: readonly string[]): string {
  const total = values.reduce((sum, v) => sum + (scaled(v, 3) ?? 0n), 0n);
  const whole = total / 1000n;
  return `${whole}.${(total % 1000n).toString().padStart(3, '0')}`;
}

export interface RatePoint {
  rate: string;
  region: string | null;
  effectiveFrom: string;
}

/**
 * The rate in force on a date: the latest one effective on or before it. A rate for the estimate's own region wins
 * over a region-free rate, even an older one; a rate for another region is never used.
 */
export function rateOn(
  rates: readonly RatePoint[],
  onDate: string,
  region: string | null,
): RatePoint | null {
  const live = rates.filter((r) => r.effectiveFrom <= onDate);
  const latest = (xs: readonly RatePoint[]) =>
    xs.reduce<RatePoint | null>(
      (best, r) => (!best || r.effectiveFrom > best.effectiveFrom ? r : best),
      null,
    );
  const own = region
    ? latest(live.filter((r) => r.region?.toLowerCase() === region.toLowerCase()))
    : null;
  return own ?? latest(live.filter((r) => r.region === null));
}
