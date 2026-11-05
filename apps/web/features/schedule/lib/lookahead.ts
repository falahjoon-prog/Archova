import { addDays, type LocalDate } from '@archova/time';

interface Item {
  activity: { id: string; start: string; finish: string };
  startsInWindow: boolean;
}

export interface WeekGroup<T extends Item> {
  start: LocalDate;
  items: T[];
  /** Activities that begin this week (the rest are carried through from an earlier one). */
  starting: Set<string>;
}

/** Puts each activity under every week it runs in, so the trades see their work in each week it is on site. */
export function groupByWeek<T extends Item>(
  items: readonly T[],
  windowStart: LocalDate,
  weeks: number,
): WeekGroup<T>[] {
  const out: WeekGroup<T>[] = [];
  for (let w = 0; w < weeks; w++) {
    const start = addDays(windowStart, w * 7);
    const end = addDays(start, 6);
    const inWeek = items.filter((i) => i.activity.start <= end && i.activity.finish >= start);
    out.push({
      start,
      items: inWeek,
      starting: new Set(inWeek.filter((i) => i.activity.start >= start).map((i) => i.activity.id)),
    });
  }
  return out;
}
