import type { LocalDate } from '@archova/time';
import { formatLocalDate } from '@/shared/lib/format';

export const CAUSE_LABELS = {
  weather: 'Weather',
  client: 'Client',
  design: 'Design',
  subcontractor: 'Subcontractor',
  authority: 'Authority',
  industrial: 'Industrial',
  other: 'Other',
} as const;
export type Cause = keyof typeof CAUSE_LABELS;

export const SOURCE_LABELS = { diary: 'Site diary', rfi: 'RFI' } as const;

export const KIND_LABELS = {
  diary_delay: 'Diary delay',
  rfi_schedule_impact: 'RFI schedule impact',
  rfi_late_answer: 'RFI answered late',
} as const;

export const REASON_LABELS = {
  eot_granted: 'EOT granted',
  variation: 'Variation',
  other: 'Other',
} as const;

export const FIELD_LABELS = {
  possessionDate: 'Site possession',
  pcTarget: 'PC target',
  pcActual: 'PC actual',
  dlpEnd: 'End of defects liability',
  ldRatePerDay: 'LD rate per day',
  sectionAdded: 'Section added',
  sectionRenamed: 'Section renamed',
  sectionTarget: 'Section target',
  sectionActual: 'Section actual',
  sectionRemoved: 'Section removed',
} as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "PC in 84 days (target 18 Mar 2027)", "PC is due today", "PC is 3 days past target", or null before a target is set. */
export function pcCountdown(k: {
  pcTarget: LocalDate | null;
  pcActual: LocalDate | null;
  daysToPc: number | null;
}): string | null {
  if (k.pcActual) return `PC reached ${formatLocalDate(k.pcActual)}`;
  if (!k.pcTarget || k.daysToPc === null) return null;
  const target = formatLocalDate(k.pcTarget);
  if (k.daysToPc === 0) return `PC is due today (target ${target})`;
  if (k.daysToPc < 0) return `PC is ${plural(-k.daysToPc, 'day')} past target (${target})`;
  return `PC in ${plural(k.daysToPc, 'day')} (target ${target})`;
}

/** LD rate as dollars with cents only when needed: `$4,500`. */
export function formatLdRate(rate: string | null, currency: string): string | null {
  if (rate === null) return null;
  const n = Number(rate);
  const text = new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
  return text;
}

/** A history value as a person reads it: dates as `18 Mar 2027`, the LD rate as money. */
export function formatChangeValue(field: string, value: string | null): string {
  if (value === null) return 'not set';
  if (field === 'ldRatePerDay') return formatLdRate(value, 'AUD') ?? value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLocalDate(value);
  return value;
}

/** Time lost in one register row: hours for diary lines, days for RFIs. */
export function timeLost(row: { hours: number | null; days: number | null }): string {
  if (row.hours !== null) return `${row.hours} h`;
  if (row.days !== null) return plural(row.days, 'day');
  return '—';
}

export const DEP_LABELS = {
  FS: 'Finish to start',
  SS: 'Start to start',
  FF: 'Finish to finish',
  SF: 'Start to finish',
} as const;

/** The import request carries the file as text; the API takes up to about 900 KB. */
export const MAX_IMPORT_CHARS = 900_000;

/** Which reader a file name suggests: `.xer` is Primavera P6, `.xml` is MS Project. */
export function formatForFile(name: string): 'msp' | 'p6' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xer')) return 'p6';
  if (lower.endsWith('.xml')) return 'msp';
  return null;
}

export const SOURCE_NAMES = { native: 'Archova', msp: 'MS Project', p6: 'Primavera P6' } as const;

/** "Float 3 days", "No float" or, for finished work, nothing worth saying. */
export function floatLabel(floatDays: number, critical: boolean): string {
  if (critical) return 'Critical';
  if (floatDays <= 0) return 'No float';
  return `Float ${floatDays} ${floatDays === 1 ? 'day' : 'days'}`;
}
