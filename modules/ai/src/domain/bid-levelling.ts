// Nova's bid levelling (ai/10): code puts every confirmed bid on the package's scope schedule, works out what each gap
// would cost (the median of what the other bids charge for it), each bid's normalised total and its rank before the
// model sees anything, then checks what comes back: only real bids, scope lines and unmatched lines, only figures the
// input holds, and a recommendation that is never a commitment. Pure, no IO.
import type { BidLevelInput, BidLevelOutput } from '@archova/ai-prompts';
import { fromCents, figuresIn, toCents } from './quote-negotiate';

/** Others needed to price a scope line before code will put an allowance on a bid's gap for it. */
export const MIN_OTHERS_FOR_ALLOWANCE = 2;
/** Bids needed before the median of the normalised totals means anything. */
export const MIN_BIDS_FOR_MEDIAN = 3;

export const LEVEL_DISCLAIMER =
  'Nova is an AI assistant, not a licensed agent. Nova suggests; you decide, and nothing is agreed or awarded from here.';

/** What `estimating.api.bidsForLevelling` returns: prices and terms on the schedule, no company, contact or allowance. */
export interface BidsForLevelling {
  trade: string;
  scope: Array<{ key: string; description: string; unit: string }>;
  bids: Array<{
    label: string;
    quoteId: string;
    totalExGst: string;
    validUntil: string | null;
    validityExpired: boolean;
    cells: Array<{
      scopeKey: string;
      amountExGst: string | null;
      provisional: boolean;
      excluded: boolean;
    }>;
    unmapped: Array<{ ref: string; description: string; amountExGst: string }>;
    exclusions: Array<{ text: string; scopeKey: string | null }>;
    qualifications: Array<{ text: string; scopeKey: string | null }>;
  }>;
}

export interface LevelGap {
  scopeKey: string;
  /** `excluded` when a note on the bid names the line; otherwise the bid simply doesn't price it. */
  reason: 'excluded' | 'unpriced';
  /** What code would add; null when fewer than two other bids price the line. */
  allowanceExGst: string | null;
}

export interface LevelledBid {
  label: string;
  quoteId: string;
  totalExGst: string;
  normalisedExGst: string;
  rank: number;
  validityExpired: boolean;
  provisionalExGst: string;
  gaps: LevelGap[];
}

export interface Levelled {
  bids: LevelledBid[];
  medianNormalisedExGst: string | null;
  /** The Nova input, minus the conversation. */
  input: Omit<BidLevelInput, 'history' | 'question'>;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export function levelBids(f: BidsForLevelling): Levelled {
  const prices = new Map<string, Map<string, number>>();
  for (const s of f.scope) prices.set(s.key, new Map());
  for (const b of f.bids)
    for (const c of b.cells)
      if (c.amountExGst !== null) prices.get(c.scopeKey)?.set(b.label, toCents(c.amountExGst));

  const rows = f.bids.map((b) => {
    const cells = b.cells.map((c) => {
      const others = [...(prices.get(c.scopeKey) ?? new Map()).entries()]
        .filter(([label]) => label !== b.label)
        .map(([, v]) => v as number);
      const gap = c.amountExGst === null;
      const allowance = gap && others.length >= MIN_OTHERS_FOR_ALLOWANCE ? median(others) : null;
      return { ...c, allowance, gap };
    });
    const normalised = toCents(b.totalExGst) + cells.reduce((n, c) => n + (c.allowance ?? 0), 0);
    return { b, cells, normalised };
  });

  const order = [...rows].sort(
    (x, y) => x.normalised - y.normalised || x.b.label.localeCompare(y.b.label),
  );
  const rankOf = new Map(order.map((r, i) => [r.b.label, i + 1]));
  const medianNormalised =
    rows.length >= MIN_BIDS_FOR_MEDIAN ? fromCents(median(rows.map((r) => r.normalised))) : null;

  const bids: LevelledBid[] = rows.map(({ b, cells, normalised }) => ({
    label: b.label,
    quoteId: b.quoteId,
    totalExGst: b.totalExGst,
    normalisedExGst: fromCents(normalised),
    rank: rankOf.get(b.label)!,
    validityExpired: b.validityExpired,
    provisionalExGst: fromCents(
      cells
        .filter((c) => c.provisional && c.amountExGst !== null)
        .reduce((n, c) => n + toCents(c.amountExGst!), 0),
    ),
    gaps: cells
      .filter((c) => c.gap)
      .map((c) => ({
        scopeKey: c.scopeKey,
        reason: c.excluded ? ('excluded' as const) : ('unpriced' as const),
        allowanceExGst: c.allowance === null ? null : fromCents(c.allowance),
      })),
  }));

  return {
    bids,
    medianNormalisedExGst: medianNormalised,
    input: {
      trade: f.trade,
      scope: f.scope,
      bids: rows.map(({ b, cells, normalised }) => ({
        label: b.label as `Bid ${string}`,
        totalExGst: b.totalExGst,
        normalisedExGst: fromCents(normalised),
        rank: rankOf.get(b.label)!,
        validUntil: b.validUntil,
        validityExpired: b.validityExpired,
        cells: cells.map((c) => ({
          scopeKey: c.scopeKey,
          amountExGst: c.amountExGst,
          provisional: c.provisional,
          excluded: c.excluded,
          allowanceExGst: c.allowance === null ? null : fromCents(c.allowance),
        })),
        unmapped: b.unmapped,
        exclusions: b.exclusions.map((e) => e.text),
        qualifications: b.qualifications.map((q) => q.text),
      })),
      medianNormalisedExGst: medianNormalised,
    },
  };
}

export interface ReviewedLevelling {
  summary: string;
  mappings: Array<{
    bid: string;
    quoteId: string;
    ref: string;
    description: string;
    amountExGst: string;
    scopeKey: string;
    reason: string;
  }>;
  gaps: BidLevelOutput['gaps'];
  risks: BidLevelOutput['risks'];
  recommendation: {
    bid: string | null;
    quoteId: string | null;
    reasoning: string;
    conditions: string[];
    /** Code's own check: is the recommended bid also the lowest normalised price? Null with no recommendation. */
    isLowestNormalised: boolean | null;
  };
  /** What code removed or added, so a trimmed answer is not mistaken for a complete one. */
  notes: string[];
}

const RENEW = /\b(renew|extend|extension|validity|valid)/i;

export function reviewLevelling(
  out: BidLevelOutput,
  facts: BidsForLevelling,
  levelled: Levelled,
): ReviewedLevelling {
  const notes: string[] = [];
  const byLabel = new Map(facts.bids.map((b) => [b.label, b]));
  const scopeKeys = new Set(facts.scope.map((s) => s.key));

  const allowed = new Set<number>();
  const allow = (v: string | null | undefined) => {
    if (v) allowed.add(Math.abs(toCents(v)));
  };
  for (const b of facts.bids) {
    allow(b.totalExGst);
    b.cells.forEach((c) => allow(c.amountExGst));
    b.unmapped.forEach((u) => allow(u.amountExGst));
  }
  for (const b of levelled.bids) {
    allow(b.normalisedExGst);
    allow(b.provisionalExGst);
    b.gaps.forEach((g) => allow(g.allowanceExGst));
  }
  allow(levelled.medianNormalisedExGst);
  // The difference between any two bids' normalised totals is a figure code can stand behind.
  for (const x of levelled.bids)
    for (const y of levelled.bids)
      allowed.add(Math.abs(toCents(x.normalisedExGst) - toCents(y.normalisedExGst)));
  const supported = (t: string) => figuresIn(t).every((c) => allowed.has(c));

  const sentences = out.summary.split(/(?<=[.!?])\s+/).filter(Boolean);
  const kept = sentences.filter(supported);
  if (kept.length < sentences.length)
    notes.push('Sentences with figures that are not in the bids were removed.');
  const first = [...levelled.bids].sort((a, b) => a.rank - b.rank)[0]!;
  const summary =
    kept.join(' ') ||
    `${levelled.bids.length} bid${levelled.bids.length === 1 ? '' : 's'} levelled onto the scope schedule. ${first.label} has the lowest normalised total ($${first.normalisedExGst}).`;

  const seen = new Set<string>();
  const mappings: ReviewedLevelling['mappings'] = [];
  for (const m of out.mappings) {
    const bid = byLabel.get(m.bid);
    const line = bid?.unmapped.find((u) => u.ref === m.ref);
    const key = `${m.bid}:${m.ref}`;
    if (!bid || !line || !scopeKeys.has(m.scopeKey) || seen.has(key) || !supported(m.reason))
      continue;
    seen.add(key);
    mappings.push({
      bid: bid.label,
      quoteId: bid.quoteId,
      ref: line.ref,
      description: line.description,
      amountExGst: line.amountExGst,
      scopeKey: m.scopeKey,
      reason: m.reason,
    });
  }
  if (mappings.length < out.mappings.length)
    notes.push('A suggested match to a line that does not exist was removed.');

  const gaps = out.gaps.filter(
    (g) =>
      byLabel.has(g.bid) && (g.scopeKey === null || scopeKeys.has(g.scopeKey)) && supported(g.text),
  );
  const risks = out.risks.filter((r) => byLabel.has(r.bid) && supported(r.text));
  if (gaps.length < out.gaps.length || risks.length < out.risks.length)
    notes.push('A point about an unknown bid or with an unsupported figure was removed.');

  const rec = out.recommendation;
  let recBid = rec.bid && byLabel.has(rec.bid) ? rec.bid : null;
  if (rec.bid && !recBid) notes.push('The recommended bid does not exist, so none is recommended.');
  if (recBid && facts.bids.length < 2) {
    recBid = null;
    notes.push('With one bid there is nothing to compare, so none is recommended.');
  }
  let reasoning = rec.reasoning;
  if (!supported(reasoning)) {
    reasoning = '';
    notes.push('The reasoning used a figure that is not in the bids, so it was left out.');
  }
  const conditions = rec.conditions.filter(supported);
  const chosen = recBid ? levelled.bids.find((b) => b.label === recBid)! : null;
  if (chosen?.validityExpired && !conditions.some((c) => RENEW.test(c))) {
    conditions.push("Ask the subcontractor to renew the bid's validity before awarding.");
    notes.push(
      "The recommended bid's validity has passed, so renewing it was added as a condition.",
    );
  }

  return {
    summary,
    mappings,
    gaps,
    risks,
    recommendation: {
      bid: recBid,
      quoteId: chosen?.quoteId ?? null,
      reasoning,
      conditions,
      isLowestNormalised: chosen ? chosen.rank === 1 : null,
    },
    notes,
  };
}
