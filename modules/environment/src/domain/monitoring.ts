// Monitoring points and readings: the catalogue of what is measured, how a reading is judged against its limits,
// and the rule-based trend / overdue checks Nova raises. Pure, no IO.
import { addDays, daysBetween } from '@archova/time';

export const PARAMETERS = [
  'dust_pm10',
  'dust_pm25',
  'dust_deposition',
  'noise_laeq',
  'noise_lamax',
  'vibration_ppv',
  'water_ph',
  'water_turbidity',
  'water_tss',
  'other',
] as const;
export type Parameter = (typeof PARAMETERS)[number];

export const MONITORING_FREQUENCIES = [
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'per_event',
] as const;
export type MonitoringFrequency = (typeof MONITORING_FREQUENCIES)[number];

export const READING_STATUSES = ['ok', 'warning', 'breach'] as const;
export type ReadingStatus = (typeof READING_STATUSES)[number];

/** Days a reading may be missing before the point is overdue: the interval plus a day of grace. */
const OVERDUE_AFTER_DAYS: Partial<Record<MonitoringFrequency, number>> = {
  daily: 2,
  weekly: 8,
  fortnightly: 15,
  monthly: 32,
};

export interface Limits {
  min: number | null;
  max: number | null;
  /** Fraction of the limit that counts as "close to it", for example 0.2 = within 20%. */
  warnMargin: number;
}

/**
 * Judges a value against the limits. Over the maximum or under the minimum is a breach; inside but close to a limit
 * is a warning. "Close" is `warnMargin` of the allowed range when there are two limits (pH 6.5 to 8.5 at 10% warns
 * from 8.3 up and 6.7 down), or of the limit itself when there is one (dust at 50 and 20% warns from 40).
 */
export function judgeReading(value: number, l: Limits): ReadingStatus {
  if ((l.max !== null && value > l.max) || (l.min !== null && value < l.min)) return 'breach';
  if (l.max !== null && l.min !== null) {
    const band = (l.max - l.min) * l.warnMargin;
    return value >= l.max - band || value <= l.min + band ? 'warning' : 'ok';
  }
  if (l.max !== null) return value >= l.max * (1 - l.warnMargin) ? 'warning' : 'ok';
  return l.min !== null && value <= l.min * (1 + l.warnMargin) ? 'warning' : 'ok';
}

export function isPointOverdue(
  frequency: MonitoringFrequency,
  lastReadingDate: string | null,
  createdDate: string,
  today: string,
): boolean {
  const grace = OVERDUE_AFTER_DAYS[frequency];
  if (grace === undefined) return false;
  const since = lastReadingDate ?? createdDate;
  return daysBetween(since, today) > grace;
}

/**
 * True when the latest three readings (oldest first) rise each time and the newest is in the warning band: the
 * point is heading for its limit. Needs a maximum limit; minimum-only points are not trended.
 */
export function isTrendingToBreach(values: readonly number[], l: Limits): boolean {
  if (values.length < 3 || l.max === null) return false;
  const [a, b, c] = values.slice(-3) as [number, number, number];
  return a < b && b < c && judgeReading(c, l) === 'warning';
}

export const dayBefore = (date: string, days: number) => addDays(date, -days);
