// Business-day counting for statutory deadlines such as SOPA payment schedules (conventions §Time).
// The rules differ by state, so callers pass that state's public holidays; the `financials` module owns
// the holiday tables and the per-state rules, and clients use this only to preview a due date.

import { type LocalDate, addDays, isoWeekday } from './local-date';

export interface BusinessDayCalendar {
  /** Public holidays (and any other excluded days, e.g. 27-31 Dec where a state's Act says so). */
  holidays?: ReadonlySet<LocalDate>;
  /** ISO weekdays that are not business days. Default Saturday and Sunday. */
  weekend?: readonly number[];
}

export function isBusinessDay(date: LocalDate, calendar: BusinessDayCalendar = {}): boolean {
  const weekend = calendar.weekend ?? [6, 7];
  return !weekend.includes(isoWeekday(date)) && !(calendar.holidays?.has(date) ?? false);
}

/**
 * The date `n` business days after `date`, not counting `date` itself (the usual reading of
 * "within 10 business days after the claim is served"). Negative `n` counts backwards.
 */
export function addBusinessDays(
  date: LocalDate,
  n: number,
  calendar: BusinessDayCalendar = {},
): LocalDate {
  if (!Number.isInteger(n)) throw new RangeError('n must be an integer');
  const step = n < 0 ? -1 : 1;
  let remaining = Math.abs(n);
  let current = date;
  while (remaining > 0) {
    current = addDays(current, step);
    if (isBusinessDay(current, calendar)) remaining -= 1;
  }
  return current;
}
