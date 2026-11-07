// Geometry for the Gantt chart: which days it spans, where a bar starts and how wide it is, and the week ticks.
// Pure, so it is tested without a browser.
import { addDays, compareLocalDates, daysBetween, isoWeekday, type LocalDate } from '@archova/time';

export const ZOOMS = { day: 28, week: 12, month: 4 } as const;
export type Zoom = keyof typeof ZOOMS;

export interface Span {
  start: LocalDate;
  /** Last day shown. */
  end: LocalDate;
  days: number;
}

/** The days the chart spans: the programme's dates (and today, so the marker is always visible), padded to whole weeks. */
export function chartSpan(dates: readonly LocalDate[], today: LocalDate, minDays = 28): Span {
  const all = dates.length ? [...dates, today] : [today];
  let lo = all[0]!;
  let hi = all[0]!;
  for (const d of all) {
    if (compareLocalDates(d, lo) < 0) lo = d;
    if (compareLocalDates(d, hi) > 0) hi = d;
  }
  const start = addDays(lo, 1 - isoWeekday(lo) - 7);
  let end = addDays(hi, 7 - isoWeekday(hi) + 7);
  if (daysBetween(start, end) + 1 < minDays) end = addDays(start, minDays - 1);
  return { start, end, days: daysBetween(start, end) + 1 };
}

export interface BarBox {
  left: number;
  width: number;
}

/** Pixel box of an activity: a task covers its first through last day; a milestone is one day wide, centred on it. */
export function barBox(span: Span, start: LocalDate, finish: LocalDate, dayWidth: number): BarBox {
  const left = daysBetween(span.start, start) * dayWidth;
  const width = (daysBetween(start, finish) + 1) * dayWidth;
  return { left, width };
}

export interface Tick {
  date: LocalDate;
  left: number;
  label: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One tick per Monday; the label is the day and month, thinned out when the weeks are narrow. */
export function weekTicks(span: Span, dayWidth: number, minGap = 56): Tick[] {
  const out: Tick[] = [];
  const every = Math.max(1, Math.ceil(minGap / (dayWidth * 7)));
  let n = 0;
  for (let d = span.start; compareLocalDates(d, span.end) <= 0; d = addDays(d, 7), n++) {
    if (n % every !== 0) continue;
    const [, m, day] = d.split('-').map(Number) as [number, number, number];
    out.push({
      date: d,
      left: daysBetween(span.start, d) * dayWidth,
      label: `${day} ${MONTHS[m - 1]}`,
    });
  }
  return out;
}

/** Saturday and Sunday columns, drawn as a light background so the working week reads at a glance. */
export function weekendBands(span: Span, dayWidth: number): BarBox[] {
  const out: BarBox[] = [];
  for (let i = 0; i < span.days; i++) {
    if (isoWeekday(addDays(span.start, i)) === 6)
      out.push({ left: i * dayWidth, width: Math.min(2, span.days - i) * dayWidth });
  }
  return out;
}

export type DragMode = 'move' | 'resize';

/** Whole days a pointer travelled, snapped to the day grid. */
export function dragDays(dxPx: number, dayWidth: number): number {
  const d = Math.round(dxPx / dayWidth);
  return d === 0 ? 0 : d; // never -0
}

export interface DragDates {
  start: LocalDate;
  finish: LocalDate;
}

/**
 * The dates a drag leaves an activity on. Moving shifts both ends (a milestone is one day, so it just moves);
 * resizing moves the finish only and never lets it pass the start.
 */
export function draggedDates(
  a: { kind: 'task' | 'milestone'; start: LocalDate; finish: LocalDate },
  mode: DragMode,
  days: number,
): DragDates {
  if (mode === 'move' || a.kind === 'milestone')
    return { start: addDays(a.start, days), finish: addDays(a.finish, days) };
  const finish = addDays(a.finish, days);
  return { start: a.start, finish: compareLocalDates(finish, a.start) < 0 ? a.start : finish };
}

/** "3 days late", "2 days ahead", "On baseline"; empty when there is no baseline. */
export function varianceLabel(days: number | null): string {
  if (days === null) return '';
  if (days === 0) return 'On baseline';
  const n = Math.abs(days);
  return `${n} ${n === 1 ? 'day' : 'days'} ${days > 0 ? 'late' : 'ahead'}`;
}
