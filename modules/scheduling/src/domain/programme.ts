// Pure programme rules (product/08 S4/S5): working-day arithmetic, float and critical path from the dates on the
// programme, cycle checks and the look-ahead window. No database, no clock.
import { addDays, compareLocalDates, daysBetween, isoWeekday, type LocalDate } from '@archova/time';

export const DEP_TYPES = ['FS', 'SS', 'FF', 'SF'] as const;
export type DepType = (typeof DEP_TYPES)[number];

export interface ActivityInput {
  id: string;
  wbs: string;
  name: string;
  kind: 'task' | 'milestone';
  start: LocalDate;
  finish: LocalDate;
  pctComplete: number;
  assignee: string;
}
export interface DependencyInput {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DepType;
  lagDays: number;
}

const EPOCH_MONDAY = '1970-01-05';

/** Ordinal of a day counting Monday-Friday only; a weekend day shares the ordinal of the Monday after it. */
export function workDayOrdinal(date: LocalDate): number {
  const d = daysBetween(EPOCH_MONDAY, date);
  const week = Math.floor(d / 7);
  const dow = d - week * 7;
  return week * 5 + Math.min(dow, 5);
}

/** Working days from start to finish inclusive (Monday-Friday; public holidays are not modelled yet). 0 for a milestone. */
export function workingDays(start: LocalDate, finish: LocalDate): number {
  if (start === finish) return isoWeekday(start) <= 5 ? 1 : 0;
  return Math.max(
    0,
    workDayOrdinal(finish) - workDayOrdinal(start) + (isoWeekday(finish) <= 5 ? 1 : 0),
  );
}

export function durationDays(a: Pick<ActivityInput, 'kind' | 'start' | 'finish'>): number {
  return a.kind === 'milestone' ? 0 : workingDays(a.start, a.finish);
}

/** Slack of one link in working days: how far the successor could slip before the link is broken. Negative = broken. */
export function linkSlack(
  pred: Pick<ActivityInput, 'start' | 'finish'>,
  succ: Pick<ActivityInput, 'start' | 'finish'>,
  type: DepType,
  lagDays: number,
): number {
  const ps = workDayOrdinal(pred.start);
  const pf = workDayOrdinal(pred.finish);
  const ss = workDayOrdinal(succ.start);
  const sf = workDayOrdinal(succ.finish);
  switch (type) {
    case 'FS':
      return ss - (pf + 1 + lagDays);
    case 'SS':
      return ss - (ps + lagDays);
    case 'FF':
      return sf - (pf + lagDays);
    case 'SF':
      return sf - (ps + lagDays);
  }
}

export interface ActivityAnalysis {
  floatDays: number;
  critical: boolean;
}
export interface DependencyAnalysis {
  slackDays: number;
  /** The successor starts or finishes too early for this link. */
  violated: boolean;
}

/**
 * Total float from the dates on the programme: an activity with no successor can slip to the programme finish; one with
 * successors can slip by the least slack of its links plus that successor's float. Float 0 or less is critical.
 * Finished activities (100%) are never critical.
 */
export function analyse(activities: readonly ActivityInput[], deps: readonly DependencyInput[]) {
  const byId = new Map(activities.map((a) => [a.id, a]));
  const out = new Map<string, ActivityAnalysis>();
  const depOut = new Map<string, DependencyAnalysis>();
  const successors = new Map<string, DependencyInput[]>();
  for (const d of deps) {
    const p = byId.get(d.predecessorId);
    const s = byId.get(d.successorId);
    if (!p || !s) continue;
    const slack = linkSlack(p, s, d.type, d.lagDays);
    depOut.set(d.id, { slackDays: slack, violated: slack < 0 });
    const list = successors.get(p.id) ?? [];
    list.push(d);
    successors.set(p.id, list);
  }
  let end = 0;
  for (const a of activities) end = Math.max(end, workDayOrdinal(a.finish));
  const floats = new Map<string, number>();
  const visiting = new Set<string>();
  const floatOf = (id: string): number => {
    const known = floats.get(id);
    if (known !== undefined) return known;
    const a = byId.get(id)!;
    if (visiting.has(id)) return 0; // a cycle: refused on write, but never loop on bad data
    visiting.add(id);
    let f = end - workDayOrdinal(a.finish);
    for (const d of successors.get(id) ?? []) {
      const slack = depOut.get(d.id)!.slackDays;
      f = Math.min(f, slack + floatOf(d.successorId));
    }
    visiting.delete(id);
    floats.set(id, f);
    return f;
  };
  for (const a of activities) {
    const f = floatOf(a.id);
    out.set(a.id, { floatDays: f, critical: f <= 0 && a.pctComplete < 100 });
  }
  return { activities: out, dependencies: depOut };
}

/** True when linking predecessor -> successor would close a loop. */
export function wouldCycle(
  deps: readonly DependencyInput[],
  predecessorId: string,
  successorId: string,
): boolean {
  if (predecessorId === successorId) return true;
  const next = new Map<string, string[]>();
  for (const d of deps)
    next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  const seen = new Set<string>();
  const stack = [successorId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === predecessorId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

export interface LookaheadItem {
  activityId: string;
  /** Monday of the first week the activity is on site in the window. */
  startsInWindow: boolean;
  finishesInWindow: boolean;
  late: boolean;
}

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The look-ahead window: whole weeks starting the Monday of `from`. An activity is in when it overlaps the window and is
 * not finished. `late` marks work that should have started (or finished) before today and has not.
 */
export function lookahead(
  activities: readonly ActivityInput[],
  from: LocalDate,
  weeks: number,
  today: LocalDate,
) {
  const start = mondayOf(from);
  const end = addDays(start, weeks * 7 - 1);
  const items: Array<LookaheadItem & { activity: ActivityInput }> = [];
  for (const a of activities) {
    if (a.pctComplete >= 100) continue;
    if (compareLocalDates(a.finish, start) < 0 || compareLocalDates(a.start, end) > 0) continue;
    items.push({
      activity: a,
      activityId: a.id,
      startsInWindow: a.start >= start,
      finishesInWindow: a.finish <= end,
      late: (a.start < today && a.pctComplete === 0) || (a.finish < today && a.pctComplete < 100),
    });
  }
  items.sort((x, y) =>
    x.activity.start === y.activity.start
      ? x.activity.wbs.localeCompare(y.activity.wbs, undefined, { numeric: true })
      : x.activity.start < y.activity.start
        ? -1
        : 1,
  );
  return { windowStart: start, windowEnd: end, items };
}

/** The date `n` working days (Monday-Friday) after `date`; `n` below 1 returns the date unchanged. */
export function addWorkDays(date: LocalDate, n: number): LocalDate {
  let d = date;
  for (let left = n; left > 0;) {
    d = addDays(d, 1);
    if (isoWeekday(d) <= 5) left--;
  }
  return d;
}

/** Working days the finish sits after the baseline finish: positive is late, negative is ahead. */
export function varianceDays(finish: LocalDate, baselineFinish: LocalDate): number {
  return workDayOrdinal(finish) - workDayOrdinal(baselineFinish);
}

/**
 * Re-flow after an activity moves: any successor whose link is now broken is pushed later, keeping its duration, and
 * that push is carried down the chain. Nothing is ever pulled earlier, finished work is left alone and the moved
 * activity itself is not returned. Returns only the activities whose dates changed.
 */
export function cascade(
  activities: readonly ActivityInput[],
  deps: readonly DependencyInput[],
  movedId: string,
): Map<string, { start: LocalDate; finish: LocalDate }> {
  const cur = new Map(activities.map((a) => [a.id, { start: a.start, finish: a.finish }]));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const outgoing = new Map<string, DependencyInput[]>();
  for (const d of deps)
    outgoing.set(d.predecessorId, [...(outgoing.get(d.predecessorId) ?? []), d]);
  const changed = new Map<string, { start: LocalDate; finish: LocalDate }>();
  const queue = [movedId];
  // Acyclic by construction; the bound only protects against bad data.
  for (let guard = activities.length * (deps.length + 1) + 1; queue.length && guard > 0; guard--) {
    const pid = queue.shift()!;
    const p = cur.get(pid);
    if (!p) continue;
    for (const d of outgoing.get(pid) ?? []) {
      const s = byId.get(d.successorId);
      const sd = cur.get(d.successorId);
      if (!s || !sd || s.pctComplete >= 100) continue;
      const slack = linkSlack(p, sd, d.type, d.lagDays);
      if (slack >= 0) continue;
      const next = { start: addWorkDays(sd.start, -slack), finish: addWorkDays(sd.finish, -slack) };
      cur.set(s.id, next);
      changed.set(s.id, next);
      queue.push(s.id);
    }
  }
  changed.delete(movedId);
  return changed;
}
