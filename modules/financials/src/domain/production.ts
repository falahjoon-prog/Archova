// Production tracking: quantity installed against a planned quantity over time, and Nova's rule-based rate-drop
// flag. Pure; the service feeds it rows. Dates are project-local `yyyy-mm-dd` (X34), never instants.

import { addDays, daysBetween, isoWeekday, type LocalDate } from '@archova/time';

export interface Item {
  id: string;
  name: string;
  uom: string;
  trade: string | null;
  location: string | null;
  plannedQuantity: number;
  plannedStart: LocalDate;
  plannedFinish: LocalDate;
}

export interface Entry {
  itemId: string;
  loggedOn: LocalDate;
  quantity: number;
  crew: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Share of the plan that should be in place on `date`: straight line from start to finish, inclusive. */
export function plannedFraction(
  item: Pick<Item, 'plannedStart' | 'plannedFinish'>,
  date: LocalDate,
) {
  if (date < item.plannedStart) return 0;
  if (date >= item.plannedFinish) return 1;
  const span = daysBetween(item.plannedStart, item.plannedFinish) + 1;
  return (daysBetween(item.plannedStart, date) + 1) / span;
}

export interface ItemProgress {
  actual: number;
  /** Actual over planned, 0..n. */
  pctComplete: number;
  /** Planned quantity that should be in place today. */
  plannedToDate: number;
  /** Actual minus planned to date; negative is behind. */
  variance: number;
  status: 'not_started' | 'on_track' | 'behind' | 'complete';
}

/** Behind is more than this share of the planned quantity under the plan line. */
export const BEHIND_TOLERANCE = 0.05;

export function itemProgress(item: Item, actual: number, today: LocalDate): ItemProgress {
  const plannedToDate = r2(item.plannedQuantity * plannedFraction(item, today));
  const variance = r2(actual - plannedToDate);
  const status: ItemProgress['status'] =
    actual >= item.plannedQuantity
      ? 'complete'
      : today < item.plannedStart && actual === 0
        ? 'not_started'
        : variance < -item.plannedQuantity * BEHIND_TOLERANCE
          ? 'behind'
          : 'on_track';
  return {
    actual: r2(actual),
    pctComplete: r4(actual / item.plannedQuantity),
    plannedToDate,
    variance,
    status,
  };
}

export interface CurvePoint {
  /** End of each week, plus `today` so the actual line reaches the present. */
  date: LocalDate;
  planned: number;
  /** Cumulative installed; null after today. */
  actual: number | null;
}

const mondayOf = (d: LocalDate) => addDays(d, 1 - isoWeekday(d));

/**
 * Cumulative planned and actual quantity at the end of each week from the first planned start to the later of the
 * last planned finish and today. Items must share a unit of measure; the caller groups by it.
 */
export function productionCurve(
  items: readonly Item[],
  entries: readonly Entry[],
  today: LocalDate,
): CurvePoint[] {
  if (items.length === 0) return [];
  const first = items.reduce(
    (a, i) => (i.plannedStart < a ? i.plannedStart : a),
    items[0]!.plannedStart,
  );
  const last = items.reduce(
    (a, i) => (i.plannedFinish > a ? i.plannedFinish : a),
    items[0]!.plannedFinish,
  );
  const end = last > today ? last : today;
  const ids = new Set(items.map((i) => i.id));
  const mine = entries.filter((e) => ids.has(e.itemId));
  const dates: LocalDate[] = [];
  for (
    let weekEnd = addDays(mondayOf(first), 6);
    dates.length < 600;
    weekEnd = addDays(weekEnd, 7)
  ) {
    dates.push(weekEnd > end ? end : weekEnd);
    if (weekEnd >= end) break;
  }
  if (today >= first && today <= end && !dates.includes(today)) dates.push(today);
  dates.sort();
  const points: CurvePoint[] = dates.map((at) => ({
    date: at,
    planned: r2(items.reduce((a, i) => a + i.plannedQuantity * plannedFraction(i, at), 0)),
    actual:
      at > today
        ? null
        : r2(mine.filter((e) => e.loggedOn <= at).reduce((a, e) => a + e.quantity, 0)),
  }));
  return points;
}

export interface RateFlag {
  kind: 'trade' | 'crew';
  name: string;
  uom: string;
  /** Units per working day over the last 7 days. */
  recentRate: number;
  /** Units per working day over the 28 days before that. */
  baselineRate: number;
  /** Fall from baseline, 0..1. */
  dropPct: number;
}

/** Flag when the last week's rate is more than this share below the trailing four-week average. */
export const RATE_DROP_THRESHOLD = 0.2;
/** Distinct days with quantity in the baseline window before a rate means anything. */
export const MIN_BASELINE_DAYS = 5;

function workingDays(from: LocalDate, to: LocalDate): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) n++;
  return n;
}

/**
 * Nova's early signal: per trade and per named crew, the production rate (units per working day) of the last 7 days
 * against the average of the 28 days before. Weekend work counts toward the quantity, not the day count. Rule-based:
 * no model call. Rates are only compared within a unit of measure.
 */
export function rateFlags(
  items: readonly Item[],
  entries: readonly Entry[],
  today: LocalDate,
): RateFlag[] {
  const itemBy = new Map(items.map((i) => [i.id, i]));
  const recentFrom = addDays(today, -6);
  const baseFrom = addDays(recentFrom, -28);
  const baseTo = addDays(recentFrom, -1);
  const recentDays = workingDays(recentFrom, today);
  const baseDays = workingDays(baseFrom, baseTo);

  const groups = new Map<
    string,
    {
      kind: RateFlag['kind'];
      name: string;
      uom: string;
      recent: number;
      base: number;
      days: Set<string>;
    }
  >();
  const add = (kind: RateFlag['kind'], name: string, uom: string, e: Entry) => {
    const key = `${kind}\u0000${name}\u0000${uom}`;
    const g = groups.get(key) ?? { kind, name, uom, recent: 0, base: 0, days: new Set<string>() };
    if (e.loggedOn >= recentFrom && e.loggedOn <= today) g.recent += e.quantity;
    else if (e.loggedOn >= baseFrom && e.loggedOn <= baseTo) {
      g.base += e.quantity;
      if (e.quantity > 0) g.days.add(e.loggedOn);
    }
    groups.set(key, g);
  };
  for (const e of entries) {
    const item = itemBy.get(e.itemId);
    if (!item) continue;
    if (item.trade) add('trade', item.trade, item.uom, e);
    if (e.crew) add('crew', e.crew, item.uom, e);
  }
  const flags: RateFlag[] = [];
  for (const g of groups.values()) {
    if (g.days.size < MIN_BASELINE_DAYS || baseDays === 0 || recentDays === 0) continue;
    const baselineRate = g.base / baseDays;
    if (baselineRate <= 0) continue;
    const recentRate = g.recent / recentDays;
    if (recentRate >= baselineRate * (1 - RATE_DROP_THRESHOLD)) continue;
    flags.push({
      kind: g.kind,
      name: g.name,
      uom: g.uom,
      recentRate: r2(recentRate),
      baselineRate: r2(baselineRate),
      dropPct: r4(1 - recentRate / baselineRate),
    });
  }
  return flags.sort((a, b) => b.dropPct - a.dropPct || a.name.localeCompare(b.name));
}
