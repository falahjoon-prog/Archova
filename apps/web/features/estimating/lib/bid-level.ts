// Nova on the bid comparison (EST-AC6), as the preview shows it: `POST …/ai/bid-levellings` puts every confirmed bid on
// the package's scope schedule, prices each gap at the median of what the other bids charge, ranks the bids on the
// normalised total and says who Nova would take forward. Code works every figure out; the preview answers from fixed
// wording and the real answer comes from Nova. Bids are anonymous to Nova ("Bid A") and the person sees names here.
import type { LevelRow } from './levelling';
import type { NegotiationTurn } from './negotiate';
import type { Quote } from './quote-types';

export const LEVEL_DISCLAIMER =
  'Nova is an AI assistant, not a licensed agent. Nova suggests; you decide, and nothing is agreed or awarded from here.';
export const MIN_OTHERS_FOR_ALLOWANCE = 2;

export interface LevelBid {
  label: string;
  quoteId: string;
  totalCents: number;
  /** The total plus an allowance for each scope line the bid leaves out. */
  normalisedCents: number;
  rank: number;
  validityExpired: boolean;
  gaps: Array<{
    scopeKey: string;
    reason: 'excluded' | 'unpriced';
    allowanceCents: number | null;
  }>;
}

export interface BidLevelAnswer {
  summary: string;
  medianNormalisedCents: number | null;
  bids: LevelBid[];
  mappings: Array<{
    bid: string;
    quoteId: string;
    description: string;
    amountCents: number;
    scopeKey: string;
    reason: string;
  }>;
  gaps: Array<{ bid: string; scopeKey: string | null; text: string }>;
  risks: Array<{ bid: string; text: string }>;
  recommendation: {
    bid: string | null;
    quoteId: string | null;
    reasoning: string;
    conditions: string[];
    isLowestNormalised: boolean | null;
  };
  notes: string[];
  history: NegotiationTurn[];
}

export const bidLabel = (index: number) => `Bid ${String.fromCharCode(65 + index)}`;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

const fmt = (c: number) =>
  `$${(c / 100).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the server works out before Nova speaks, with Nova's part answered from fixed wording. */
export function previewBidLevel(input: {
  quotes: readonly Quote[];
  rows: readonly LevelRow[];
  expired: ReadonlySet<string>;
}): BidLevelAnswer {
  const { quotes, rows } = input;
  const base = quotes.map((q, i) => {
    const gaps = rows.flatMap((r) => {
      const cell = r.cells.find((c) => c.quoteId === q.id);
      if (!cell || cell.amountCents !== null) return [];
      const others = r.cells
        .filter((c) => c.quoteId !== q.id && c.amountCents !== null)
        .map((c) => c.amountCents as number);
      return [
        {
          scopeKey: r.scope.key,
          reason: cell.flags.includes('excluded') ? ('excluded' as const) : ('unpriced' as const),
          allowanceCents: others.length >= MIN_OTHERS_FOR_ALLOWANCE ? median(others) : null,
        },
      ];
    });
    const total = q.lines.reduce((n, l) => n + l.amountCents, 0);
    return {
      label: bidLabel(i),
      quoteId: q.id,
      totalCents: total,
      normalisedCents: total + gaps.reduce((n, g) => n + (g.allowanceCents ?? 0), 0),
      validityExpired: input.expired.has(q.id),
      gaps,
    };
  });
  const order = [...base].sort(
    (a, b) => a.normalisedCents - b.normalisedCents || a.label.localeCompare(b.label),
  );
  const bids: LevelBid[] = base.map((b) => ({ ...b, rank: order.indexOf(b) + 1 }));
  const top = order[0];
  const pick = bids.length >= 2 && top ? top : null;
  const scopeName = (k: string) => rows.find((r) => r.scope.key === k)?.scope.description ?? k;
  return {
    summary: top
      ? `${bids.length} bid${bids.length === 1 ? '' : 's'} levelled onto the scope schedule. ${top.label} has the lowest normalised total (${fmt(top.normalisedCents)}).`
      : 'There are no confirmed bids to level yet.',
    medianNormalisedCents: bids.length >= 3 ? median(bids.map((b) => b.normalisedCents)) : null,
    bids,
    mappings: [],
    gaps: bids.flatMap((b) =>
      b.gaps.map((g) => ({
        bid: b.label,
        scopeKey: g.scopeKey,
        text: `${b.label} ${g.reason === 'excluded' ? 'excludes' : 'has no price for'} ${scopeName(g.scopeKey)}.${g.allowanceCents === null ? ' Too few other bids price it to put a figure on the gap.' : ''}`,
      })),
    ),
    risks: bids
      .filter((b) => b.validityExpired)
      .map((b) => ({ bid: b.label, text: `${b.label}'s validity date has passed.` })),
    recommendation: pick
      ? {
          bid: pick.label,
          quoteId: pick.quoteId,
          reasoning: `${pick.label} has the lowest normalised total (${fmt(pick.normalisedCents)}). Check its exclusions and qualifications before you decide.`,
          conditions: pick.validityExpired
            ? ["Ask the subcontractor to renew the bid's validity before awarding."]
            : [],
          isLowestNormalised: true,
        }
      : {
          bid: null,
          quoteId: null,
          reasoning:
            bids.length < 2
              ? 'There is only one bid, so there is nothing to compare yet.'
              : 'The bids cannot be separated yet.',
          conditions: [],
          isLowestNormalised: null,
        },
    notes: [],
    history: [],
  };
}
