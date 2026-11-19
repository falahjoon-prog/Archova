// Which days of an allocation are due to be posted to the budget, and what they cost. Pure.
import { addDays, daysBetween } from '@archova/time';

/** The last day of the month before `today`'s month. */
export function lastDayOfPreviousMonth(today: string): string {
  return addDays(`${today.slice(0, 7)}-01`, -1);
}

/**
 * The days to post now, as an inclusive range, or null when there is nothing new. Once an allocation has ended its
 * whole remainder is due; while it runs, the days up to the end of last month are. Days already posted are skipped.
 */
export function postableRange(
  a: { startsOn: string; endsOn: string; postedThrough: string | null },
  today: string,
): { from: string; to: string; days: number } | null {
  const through = a.endsOn < today ? a.endsOn : lastDayOfPreviousMonth(today);
  const upTo = through > a.endsOn ? a.endsOn : through;
  const from = a.postedThrough ? addDays(a.postedThrough, 1) : a.startsOn;
  if (from > upTo) return null;
  return { from, to: upTo, days: daysBetween(from, upTo) + 1 };
}
