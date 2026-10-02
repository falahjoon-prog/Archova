// Quote levelling (F1.3b step 4, EST-AC6): scope lines × current quotes, with flags per cell and like-for-like
// totals when the estimator's allowances are added. Pure, so the table, the award rule and tests agree.

import {
  GST_RATE,
  type Quote,
  type QuoteLine,
  type ScopeLine,
  type TenderPackage,
} from './quote-types';

export type CellFlag = 'missing' | 'excluded' | 'provisional' | 'outlier' | 'corrected';

export interface LevelCell {
  quoteId: string;
  line: QuoteLine | null;
  amountCents: number | null;
  allowanceCents: number | null;
  flags: CellFlag[];
  exclusion: string | null;
}

export interface LevelRow {
  scope: ScopeLine;
  cells: LevelCell[];
  medianCents: number | null;
}

export interface QuoteTotals {
  quoteId: string;
  quotedCents: number;
  /** Quoted plus allowances for missing and excluded lines. */
  normalisedCents: number;
  gstCents: number;
  /** Lines in the quote that match no scope line. */
  otherLines: QuoteLine[];
  expired: boolean;
  gaps: number;
}

/** A priced cell more than this far from the row median is flagged (needs 3+ prices to mean anything). */
export const OUTLIER_RATIO = 0.25;

export const allowanceKey = (quoteId: string, scopeKey: string) => `${quoteId}:${scopeKey}`;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

/** Quotes that take part in the comparison: the latest confirmed version from each company. */
export function comparableQuotes(quotes: readonly Quote[]): Quote[] {
  return quotes.filter((q) => q.status === 'confirmed');
}

export function levelQuotes(
  pkg: Pick<TenderPackage, 'scope' | 'allowances'>,
  quotes: readonly Quote[],
  today: string,
): { rows: LevelRow[]; totals: QuoteTotals[] } {
  const rows: LevelRow[] = pkg.scope.map((scope) => {
    const cells: LevelCell[] = quotes.map((q) => {
      const line = q.lines.find((l) => l.scopeKey === scope.key) ?? null;
      const exclusion = q.exclusions.find((e) => e.scopeKey === scope.key) ?? null;
      const flags: CellFlag[] = [];
      if (exclusion) flags.push('excluded');
      else if (!line) flags.push('missing');
      if (line?.isProvisional) flags.push('provisional');
      if (line?.originalAmountCents !== null && line?.originalAmountCents !== undefined)
        flags.push('corrected');
      const allowance = pkg.allowances[allowanceKey(q.id, scope.key)];
      return {
        quoteId: q.id,
        line,
        amountCents: exclusion ? null : (line?.amountCents ?? null),
        allowanceCents: allowance ?? null,
        flags,
        exclusion: exclusion?.text ?? null,
      };
    });
    const priced = cells.flatMap((c) => (c.amountCents === null ? [] : [c.amountCents]));
    const med = priced.length >= 3 ? median(priced) : null;
    if (med) {
      for (const c of cells) {
        if (c.amountCents !== null && Math.abs(c.amountCents - med) / med > OUTLIER_RATIO)
          c.flags.push('outlier');
      }
    }
    return { scope, cells, medianCents: med };
  });

  const scopeKeys = new Set(pkg.scope.map((s) => s.key));
  const totals: QuoteTotals[] = quotes.map((q, i) => {
    const otherLines = q.lines.filter((l) => !l.scopeKey || !scopeKeys.has(l.scopeKey));
    const matched = rows.reduce((sum, r) => sum + (r.cells[i]!.amountCents ?? 0), 0);
    const other = otherLines.reduce((sum, l) => sum + l.amountCents, 0);
    const quotedCents = matched + other;
    const allowances = rows.reduce((sum, r) => {
      const c = r.cells[i]!;
      return sum + (c.amountCents === null ? (c.allowanceCents ?? 0) : 0);
    }, 0);
    return {
      quoteId: q.id,
      quotedCents,
      normalisedCents: quotedCents + allowances,
      gstCents: Math.round(quotedCents * GST_RATE),
      otherLines,
      expired: q.validUntil !== null && q.validUntil < today,
      gaps: rows.filter((r) => r.cells[i]!.amountCents === null).length,
    };
  });
  return { rows, totals };
}

/** The lowest total, normalised when the estimator has filled gaps (like for like). */
export function lowestQuoteId(totals: readonly QuoteTotals[], normalised: boolean): string | null {
  const key = normalised ? 'normalisedCents' : 'quotedCents';
  return [...totals].sort((a, b) => a[key] - b[key])[0]?.quoteId ?? null;
}

/** Scope lines from a CSV paste: `description,quantity,unit` per line; a header row is skipped. */
export function parseScopeCsv(text: string, makeKey: (i: number) => string): ScopeLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l, i) => !(i === 0 && /^description\b/i.test(l)))
    .map((l, i) => {
      const [description = '', qty = '', unit = ''] = l.split(',').map((c) => c.trim());
      const n = Number(qty);
      return {
        key: makeKey(i),
        description,
        quantity: qty === '' || Number.isNaN(n) ? null : n,
        unit: unit || 'item',
        source: 'csv' as const,
      };
    })
    .filter((l) => l.description);
}
