import { formatDate, formatDateTime } from '@archova/i18n';
import {
  addBusinessDays,
  addDays,
  daysBetween,
  isBusinessDay,
  type BusinessDayCalendar,
  type LocalDate,
} from '@archova/time';

// Display helpers for project screens. Times are always shown in the project's time zone (conventions §Time).

/** `2 Oct 2026` for a project-local date (`YYYY-MM-DD`). Formats at UTC noon so no zone can shift the day. */
export function formatLocalDate(date: LocalDate): string {
  return formatDate(`${date}T12:00:00Z`, 'UTC');
}

export function formatInstant(iso: string, timeZone: string): string {
  return formatDateTime(iso, timeZone);
}

/** Today's date in a time zone, as `YYYY-MM-DD`. */
export function todayIn(timeZone: string, now: Date = new Date()): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return parts;
}

/**
 * Business days from `from` (exclusive) to `to` (inclusive), negative when `to` is earlier. Counts weekends only
 * until the project calendar (state public holidays, company non-working days; RFI-AC3) is served by the API.
 */
export function businessDaysBetween(
  from: LocalDate,
  to: LocalDate,
  calendar?: BusinessDayCalendar,
): number {
  const total = daysBetween(from, to);
  const step = total < 0 ? -1 : 1;
  let n = 0;
  for (let i = 1; i <= Math.abs(total); i++) {
    if (isBusinessDay(addDays(from, i * step), calendar)) n += step;
  }
  return n;
}

/** The default due date: `n` business days after `from` (RFI-AC3 defaults to 5). */
export function dueInBusinessDays(
  from: LocalDate,
  n: number,
  calendar?: BusinessDayCalendar,
): LocalDate {
  return addBusinessDays(from, n, calendar);
}

/** Money from the API's `{ amount, currency }`, AUD by default, always labelled ex or inc GST by the caller. */
export { formatMoney } from '@archova/i18n';
