// EST-AC6 quote comparison: the confirmed quotes on a package side by side, one column per quote and one row per scope
// line, with the flags an estimator looks for before awarding: lines a quote doesn't price, exclusions and
// qualifications, provisional sums, a validity date that has passed, and prices far from the middle of the field. All
// of it is arithmetic on what the estimator confirmed; no model is involved (Nova's part is reading the quote, ai/10).
import { fromCents, lowestQuote, toCents } from './tender';

/** A price this far above or below the median of the quotes is flagged (percent of the median). */
export const OUTLIER_PERCENT = 25;
/** ...but only when it is also at least this far from it, so a $40 line is never an outlier (cents). */
export const OUTLIER_MIN_CENTS = 50_000;
/** A median of fewer than three prices says little, so nothing is flagged below this. */
export const OUTLIER_MIN_PRICES = 3;

export interface CompareScopeLine {
  key: string;
  description: string;
  quantity: string | null;
  unit: string;
}

export interface CompareQuote {
  id: string;
  companyId: string;
  revision: number;
  status: string;
  reference: string | null;
  receivedAt: Date;
  /** YYYY-MM-DD */
  validUntil: string | null;
  totalExGst: string;
  lines: ReadonlyArray<{
    id: string;
    scopeKey: string | null;
    amount: string;
    isProvisional: boolean;
  }>;
  exclusions: ReadonlyArray<{ id: string; text: string; scopeKey: string | null }>;
  qualifications: ReadonlyArray<{ id: string; text: string; scopeKey: string | null }>;
}

export type CellState = 'priced' | 'provisional' | 'missing';
export type Deviation = 'high' | 'low';

export interface ComparisonCell {
  quoteId: string;
  /** `provisional` when any line for the scope line is a provisional or prime cost sum. */
  state: CellState;
  /** The quote's price for the scope line, summed over its lines for it; null when missing. */
  amountExGst: string | null;
  /** The estimator's allowance for the gap (package allowances keyed `quoteId:scopeKey`), if any. */
  allowanceExGst: string | null;
  /** An exclusion on the quote names this scope line. */
  excluded: boolean;
  deviation: Deviation | null;
}

export interface ComparisonRow extends CompareScopeLine {
  /** Median price across the quotes that price it; null when fewer than OUTLIER_MIN_PRICES do. */
  medianExGst: string | null;
  cells: ComparisonCell[];
}

export interface ComparisonColumn {
  quoteId: string;
  companyId: string;
  revision: number;
  reference: string | null;
  receivedAt: Date;
  validUntil: string | null;
  /** Today is after the date the quote says it is valid until. */
  validityExpired: boolean;
  totalExGst: string;
  /** Every allowance the estimator set against this quote, on scope lines or not. */
  allowancesExGst: string;
  /** The total plus the allowances: what the quotes are ranked on (`lowestQuote`). */
  levelledTotalExGst: string;
  isLowest: boolean;
  /** The levelled total against the median of the levelled totals. */
  deviation: Deviation | null;
  provisionalExGst: string;
  provisionalLines: number;
  /** Scope lines the quote has no line for, in scope order. */
  missingScopeKeys: string[];
  /** Lines naming no scope line of the package: in the total, not comparable row by row. */
  unmappedLines: number;
  unmappedExGst: string;
  outlierLines: number;
  exclusions: CompareQuote['exclusions'];
  qualifications: CompareQuote['qualifications'];
}

export interface Comparison {
  columns: ComparisonColumn[];
  rows: ComparisonRow[];
  /** Median of the levelled totals; null when fewer than OUTLIER_MIN_PRICES quotes compete. */
  medianTotalExGst: string | null;
}

/** The middle price, or the cent-rounded mean of the two in the middle. */
export function median(cents: readonly number[]): number {
  const s = [...cents].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Flags a price more than OUTLIER_PERCENT from the median and at least OUTLIER_MIN_CENTS away. */
export function deviationOf(cents: number, mid: number): Deviation | null {
  if (mid <= 0) return null;
  const gap = Math.abs(cents - mid);
  if (gap < OUTLIER_MIN_CENTS || gap * 100 <= mid * OUTLIER_PERCENT) return null;
  return cents > mid ? 'high' : 'low';
}

/**
 * Compares the confirmed quotes (the ones in the running; drafts, superseded and declined quotes don't compete).
 * `today` is the project's local date, so a quote valid "until the 30th" is still valid all of the 30th.
 */
export function compareQuotes(input: {
  scope: readonly CompareScopeLine[];
  quotes: readonly CompareQuote[];
  allowances: Readonly<Record<string, string>>;
  today: string;
}): Comparison {
  const quotes = input.quotes
    .filter((q) => q.status === 'confirmed')
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id));
  const scopeKeys = new Set(input.scope.map((s) => s.key));
  const lowest = lowestQuote(quotes, input.allowances);

  const rows: ComparisonRow[] = input.scope.map((s) => {
    const cells: ComparisonCell[] = quotes.map((q) => {
      const lines = q.lines.filter((l) => l.scopeKey === s.key);
      const allowance = input.allowances[`${q.id}:${s.key}`];
      return {
        quoteId: q.id,
        state:
          lines.length === 0
            ? 'missing'
            : lines.some((l) => l.isProvisional)
              ? 'provisional'
              : 'priced',
        amountExGst: lines.length
          ? fromCents(lines.reduce((n, l) => n + toCents(l.amount), 0))
          : null,
        allowanceExGst: allowance === undefined ? null : fromCents(toCents(allowance)),
        excluded: q.exclusions.some((e) => e.scopeKey === s.key),
        deviation: null,
      };
    });
    const prices = cells.flatMap((c) => (c.amountExGst === null ? [] : [toCents(c.amountExGst)]));
    let medianExGst: string | null = null;
    if (prices.length >= OUTLIER_MIN_PRICES) {
      const mid = median(prices);
      medianExGst = fromCents(mid);
      for (const c of cells)
        if (c.amountExGst !== null) c.deviation = deviationOf(toCents(c.amountExGst), mid);
    }
    return { ...s, medianExGst, cells };
  });

  const levelled = quotes.map((q) => {
    const extra = Object.entries(input.allowances)
      .filter(([k]) => k.startsWith(`${q.id}:`))
      .reduce((n, [, v]) => n + toCents(v), 0);
    return { allowances: extra, total: toCents(q.totalExGst) + extra };
  });
  const midTotal =
    quotes.length >= OUTLIER_MIN_PRICES ? median(levelled.map((l) => l.total)) : null;

  const columns: ComparisonColumn[] = quotes.map((q, i) => {
    const provisional = q.lines.filter((l) => l.isProvisional);
    const unmapped = q.lines.filter((l) => l.scopeKey === null || !scopeKeys.has(l.scopeKey));
    return {
      quoteId: q.id,
      companyId: q.companyId,
      revision: q.revision,
      reference: q.reference,
      receivedAt: q.receivedAt,
      validUntil: q.validUntil,
      validityExpired: q.validUntil !== null && q.validUntil < input.today,
      totalExGst: q.totalExGst,
      allowancesExGst: fromCents(levelled[i]!.allowances),
      levelledTotalExGst: fromCents(levelled[i]!.total),
      isLowest: q.id === lowest,
      deviation: midTotal === null ? null : deviationOf(levelled[i]!.total, midTotal),
      provisionalExGst: fromCents(provisional.reduce((n, l) => n + toCents(l.amount), 0)),
      provisionalLines: provisional.length,
      missingScopeKeys: rows.filter((r) => r.cells[i]!.state === 'missing').map((r) => r.key),
      unmappedLines: unmapped.length,
      unmappedExGst: fromCents(unmapped.reduce((n, l) => n + toCents(l.amount), 0)),
      outlierLines: rows.filter((r) => r.cells[i]!.deviation !== null).length,
      exclusions: q.exclusions,
      qualifications: q.qualifications,
    };
  });

  return {
    columns,
    rows,
    medianTotalExGst: midTotal === null ? null : fromCents(midTotal),
  };
}
