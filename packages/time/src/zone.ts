// IANA time zone maths with nothing but Intl (conventions §Time, X32). Runs in Node, browsers and Hermes.
// Instants are `Date` or ISO 8601 strings with `Z`; wall-clock values are always paired with a zone.

import { type LocalDate, isLocalDate, parseLocalDate } from './local-date';

export type Instant = Date | string;

const toDate = (i: Instant): Date => (typeof i === 'string' ? new Date(i) : i);

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

let canonicalNames: Map<string, string> | null | undefined;

/** Lower-cased name -> canonical spelling, when the runtime can list its zones (Hermes cannot). */
function canonicalTable(): Map<string, string> | null {
  if (canonicalNames !== undefined) return canonicalNames;
  const supported = (Intl as { supportedValuesOf?: (key: 'timeZone') => string[] })
    .supportedValuesOf;
  canonicalNames = supported
    ? new Map([...supported('timeZone'), 'UTC'].map((z) => [z.toLowerCase(), z]))
    : null;
  return canonicalNames;
}

/** True for IANA zone names such as `Australia/Brisbane` or `UTC`. Offsets and abbreviations (`+10:00`, `AEST`) are rejected. */
export function isValidTimeZone(tz: string): boolean {
  return normalizeTimeZone(tz) !== null;
}

/**
 * Returns the zone with its canonical spelling (`australia/perth` -> `Australia/Perth`), or null when it is
 * not an IANA name. Backward-compatible aliases the runtime accepts (`Australia/ACT`) are kept as given.
 */
export function normalizeTimeZone(tz: string): string | null {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return null;
  if (/^[A-Z]{2,5}$/.test(tz) && tz !== 'UTC' && tz !== 'GMT') return null;
  try {
    formatter(tz);
  } catch {
    return null;
  }
  return canonicalTable()?.get(tz.toLowerCase()) ?? tz;
}

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** ISO weekday, Monday = 1 ... Sunday = 7. */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall-clock reading in `timeZone` at `instant`. */
export function zonedParts(instant: Instant, timeZone: string): ZonedParts {
  const d = toDate(instant);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid instant');
  const out: Record<string, string> = {};
  for (const p of formatter(timeZone).formatToParts(d)) out[p.type] = p.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? ''] ?? 0,
  };
}

/** Minutes ahead of UTC in `timeZone` at `instant` (Brisbane +600, Sydney +600 or +660, Adelaide +570 or +630). */
export function utcOffsetMinutes(instant: Instant, timeZone: string): number {
  const d = toDate(instant);
  const p = zonedParts(d, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const wholeSeconds = Math.floor(d.getTime() / 1000) * 1000;
  return Math.round((asUtc - wholeSeconds) / 60_000);
}

/** The calendar date in `timeZone` at `instant`: a diary written at 23:30 in Perth belongs to Perth's date. */
export function localDateOf(instant: Instant, timeZone: string): LocalDate {
  const p = zonedParts(instant, timeZone);
  return `${String(p.year).padStart(4, '0')}-${pad(p.month)}-${pad(p.day)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * What to do with a wall-clock time that a daylight-saving change skips or repeats.
 * `compatible` (the default, as in Temporal): a skipped time moves forward by the gap; a repeated time takes the earlier instant.
 */
export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

/** Thrown with `reject` when a daylight-saving change skips (`nonexistent`) or repeats (`ambiguous`) a wall-clock time. */
export class LocalTimeError extends RangeError {
  constructor(
    readonly kind: 'nonexistent' | 'ambiguous',
    date: string,
    time: string,
    timeZone: string,
  ) {
    super(`${date} ${time} is ${kind} in ${timeZone}`);
    this.name = 'LocalTimeError';
  }
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** The UTC instant at which the wall clock in `timeZone` reads `date` `time` (`HH:mm` or `HH:mm:ss`). */
export function zonedToUtc(
  date: LocalDate,
  time: string,
  timeZone: string,
  disambiguation: Disambiguation = 'compatible',
): Date {
  const { year, month, day } = parseLocalDate(date);
  const m = TIME_RE.exec(time);
  if (!m) throw new RangeError(`Invalid local time: ${time}`);
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  const wall = Date.UTC(year, month - 1, day, h, min, s);
  const DAY = 86_400_000;
  const offBefore = utcOffsetMinutes(new Date(wall - DAY), timeZone) * 60_000;
  const offAfter = utcOffsetMinutes(new Date(wall + DAY), timeZone) * 60_000;
  const matches = [...new Set([wall - offBefore, wall - offAfter])]
    .filter((t) => {
      const p = zonedParts(new Date(t), timeZone);
      return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) === wall;
    })
    .sort((a, b) => a - b);
  if (matches.length === 1) return new Date(matches[0]!);
  if (matches.length === 2) {
    if (disambiguation === 'reject') throw new LocalTimeError('ambiguous', date, time, timeZone);
    return new Date(disambiguation === 'later' ? matches[1]! : matches[0]!);
  }
  // Skipped by a forward change. `compatible`/`later` read it with the pre-change offset, landing after the gap.
  if (disambiguation === 'reject') throw new LocalTimeError('nonexistent', date, time, timeZone);
  return new Date(disambiguation === 'earlier' ? wall - offAfter : wall - offBefore);
}

/** First instant of `date` in `timeZone`. */
export function startOfLocalDay(date: LocalDate, timeZone: string): Date {
  return zonedToUtc(date, '00:00', timeZone);
}

/**
 * Exclusive end of `date` in `timeZone` (the start of the next day). Use it for "due by end of day" so a
 * deadline is `instant < endOfLocalDay(...)`, which stays right on 23- and 25-hour days.
 */
export function endOfLocalDay(date: LocalDate, timeZone: string): Date {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  const { year, month, day } = parseLocalDate(date);
  const next = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return startOfLocalDay(next, timeZone);
}
