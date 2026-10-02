// Calendar dates without a time or zone (`YYYY-MM-DD`), as the API sends `format: date` fields.
// A LocalDate means "that day in the project's time zone"; it never converts through `new Date(...)` local time.

export type LocalDate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function parseLocalDate(date: LocalDate): { year: number; month: number; day: number } {
  if (!isLocalDate(date)) throw new RangeError(`Invalid local date: ${date}`);
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

const toUtcMidnight = (date: LocalDate) => {
  const { year, month, day } = parseLocalDate(date);
  return Date.UTC(year, month - 1, day);
};

const fromUtcMidnight = (t: number): LocalDate => new Date(t).toISOString().slice(0, 10);

const DAY = 86_400_000;

export function addDays(date: LocalDate, days: number): LocalDate {
  if (!Number.isInteger(days)) throw new RangeError('days must be an integer');
  return fromUtcMidnight(toUtcMidnight(date) + days * DAY);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / DAY);
}

export function compareLocalDates(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  const d = daysBetween(b, a);
  return d < 0 ? -1 : d > 0 ? 1 : 0;
}

/** ISO weekday, Monday = 1 ... Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const d = new Date(toUtcMidnight(date)).getUTCDay();
  return d === 0 ? 7 : d;
}
