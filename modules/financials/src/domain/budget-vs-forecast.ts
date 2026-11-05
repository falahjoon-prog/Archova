// Budget against forecast, per cost code, in whole cents ex GST. Subcontract cost to complete is what is still
// unclaimed against each schedule item; whatever part of a subcontract is not tagged to a cost code (untagged items,
// approved variations, an empty schedule) lands in "unallocated" so the totals still add up to the project forecast.

export interface BvfLine {
  costCodeId: string;
  code: string;
  description: string;
  revisedCents: number;
}

export interface BvfItem {
  costCodeId: string | null;
  valueCents: number;
  claimedCents: number;
}

export interface BvfSub {
  committedCents: number;
  claimedCents: number;
  items: BvfItem[];
}

export interface BvfAdjustment {
  costCodeId: string | null;
  amountCents: number;
}

export interface BvfRow {
  costCodeId: string | null;
  revisedCents: number;
  committedCents: number;
  claimedCents: number;
  adjustmentsCents: number;
  forecastFinalCents: number;
  varianceCents: number;
}

const blank = (costCodeId: string | null, revisedCents = 0): BvfRow => ({
  costCodeId,
  revisedCents,
  committedCents: 0,
  claimedCents: 0,
  adjustmentsCents: 0,
  forecastFinalCents: 0,
  varianceCents: 0,
});

/**
 * `hidden` are cost codes the viewer may not see (margin lines): their spend is left out of every row so the totals
 * can't be used to work the hidden amount out.
 */
export function budgetVsForecast(
  lines: BvfLine[],
  subs: BvfSub[],
  adjustments: BvfAdjustment[],
  hidden: ReadonlySet<string> = new Set(),
) {
  const rows = new Map<string, BvfRow>(
    lines.map((l) => [l.costCodeId, blank(l.costCodeId, l.revisedCents)]),
  );
  const toComplete = new Map<string | null, number>();
  const unallocated = blank(null);
  const rowFor = (id: string | null) => {
    if (id === null) return unallocated;
    let r = rows.get(id);
    if (!r) rows.set(id, (r = blank(id)));
    return r;
  };
  const add = (id: string | null, committed: number, claimed: number, remaining: number) => {
    if (id !== null && hidden.has(id)) return;
    const r = rowFor(id);
    r.committedCents += committed;
    r.claimedCents += claimed;
    toComplete.set(id, (toComplete.get(id) ?? 0) + remaining);
  };

  for (const s of subs) {
    let codedValue = 0;
    let codedClaimed = 0;
    for (const i of s.items) {
      if (i.costCodeId === null) continue;
      codedValue += i.valueCents;
      codedClaimed += i.claimedCents;
      add(i.costCodeId, i.valueCents, i.claimedCents, Math.max(i.valueCents - i.claimedCents, 0));
    }
    const remCommitted = Math.max(s.committedCents - codedValue, 0);
    const remClaimed = Math.max(s.claimedCents - codedClaimed, 0);
    add(null, remCommitted, remClaimed, Math.max(remCommitted - remClaimed, 0));
  }
  for (const a of adjustments) {
    if (a.costCodeId !== null && hidden.has(a.costCodeId)) continue;
    rowFor(a.costCodeId).adjustmentsCents += a.amountCents;
  }

  const finish = (r: BvfRow) => {
    r.forecastFinalCents =
      r.claimedCents + (toComplete.get(r.costCodeId) ?? 0) + r.adjustmentsCents;
    r.varianceCents = r.revisedCents - r.forecastFinalCents;
    return r;
  };
  const all = [...rows.values()].map(finish);
  finish(unallocated);
  const totals = blank(null);
  for (const r of [...all, unallocated]) {
    totals.revisedCents += r.revisedCents;
    totals.committedCents += r.committedCents;
    totals.claimedCents += r.claimedCents;
    totals.adjustmentsCents += r.adjustmentsCents;
    totals.forecastFinalCents += r.forecastFinalCents;
    totals.varianceCents += r.varianceCents;
  }
  return { rows: all, unallocated, totals };
}
