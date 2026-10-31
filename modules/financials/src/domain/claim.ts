import { fromCents, percentOf } from './money';

/** A claim line is against a schedule-of-values item or an approved variation: give one of the two. */
export interface ClaimLineInput {
  sovItemId?: string;
  variationId?: string;
  /** Value of the item (cents). */
  itemValue: number;
  /** Claimed on earlier claims for this item (cents). */
  previous: number;
  thisClaim: number;
}

export interface ClaimTotals {
  /** Everything claimed to date, this claim included. */
  gross: number;
  lessPrevious: number;
  retention: number;
  net: number;
  gst: number;
  total: number;
  lines: {
    sovItemId?: string;
    variationId?: string;
    previous: number;
    thisClaim: number;
    toDate: number;
  }[];
}

export interface ClaimTotalsInput {
  lines: readonly ClaimLineInput[];
  /** Hundredths of a percent: 5% is 500. */
  retentionPct: number;
  /** Cap on all retention held, in cents, or null for none. */
  retentionCap: number | null;
  retentionHeld: number;
  gstApplicable?: boolean;
}

export type ClaimError =
  | { code: 'financials.claim.empty' }
  | {
      code: 'financials.claim.over_item_value';
      sovItemId: string;
      toDate: number;
      itemValue: number;
    }
  | { code: 'financials.claim.duplicate_item'; sovItemId: string };

const keyOf = (l: { sovItemId?: string; variationId?: string }) => (l.sovItemId ?? l.variationId)!;

/**
 * Totals for one claim (CLM-AC6). A line cannot take an item past 100% of its value; that needs a variation, which
 * is a separate line type claimable once approved (CLM-AC13). Retention respects the cap, and GST is 10% of the net.
 */
export function claimTotals(input: ClaimTotalsInput): ClaimTotals | ClaimError {
  const claimed = input.lines.filter((l) => l.thisClaim > 0);
  if (claimed.length === 0) return { code: 'financials.claim.empty' };
  const seen = new Set<string>();
  for (const l of claimed) {
    const key = keyOf(l);
    if (seen.has(key)) return { code: 'financials.claim.duplicate_item', sovItemId: key };
    seen.add(key);
    if (l.previous + l.thisClaim > l.itemValue)
      return {
        code: 'financials.claim.over_item_value',
        sovItemId: key,
        toDate: l.previous + l.thisClaim,
        itemValue: l.itemValue,
      };
  }
  const lines = claimed.map((l) => ({
    ...(l.sovItemId ? { sovItemId: l.sovItemId } : {}),
    ...(l.variationId ? { variationId: l.variationId } : {}),
    previous: l.previous,
    thisClaim: l.thisClaim,
    toDate: l.previous + l.thisClaim,
  }));
  const thisClaim = lines.reduce((n, l) => n + l.thisClaim, 0);
  const lessPrevious = lines.reduce((n, l) => n + l.previous, 0);
  const room =
    input.retentionCap === null ? Infinity : Math.max(0, input.retentionCap - input.retentionHeld);
  const retention = Math.min(percentOf(thisClaim, input.retentionPct), room);
  const net = thisClaim - retention;
  const gst = input.gstApplicable === false ? 0 : percentOf(net, 1000);
  return {
    gross: lessPrevious + thisClaim,
    lessPrevious,
    retention,
    net,
    gst,
    total: net + gst,
    lines,
  };
}

export const isClaimError = (r: ClaimTotals | ClaimError): r is ClaimError => 'code' in r;

export function describeClaimError(e: ClaimError): string {
  switch (e.code) {
    case 'financials.claim.empty':
      return 'Claim at least one schedule of values item.';
    case 'financials.claim.duplicate_item':
      return 'Each schedule of values item can appear once on a claim.';
    case 'financials.claim.over_item_value':
      return `That would claim ${fromCents(e.toDate)} against an item worth ${fromCents(e.itemValue)}. Over 100% needs a variation.`;
  }
}
