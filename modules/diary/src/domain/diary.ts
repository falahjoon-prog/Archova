// Pure site diary rules (product/05, backend schema/field.md §diary, X42).
import { addDays, zonedToUtc, type LocalDate } from '@archova/time';

export type DiaryStatus = 'draft' | 'submitted' | 'signed_off';

export const LINE_KINDS = [
  'labour',
  'plant',
  'delivery',
  'delay',
  'visitor',
  'event',
  'stand_down',
] as const;
export type LineKind = (typeof LINE_KINDS)[number];

export const DELAY_TYPES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;
export type DelayType = (typeof DELAY_TYPES)[number];

/** Delay types that are ticked "possible EOT" unless the site manager says otherwise (DIA-AC4). */
const EOT_BY_DEFAULT: ReadonlySet<DelayType> = new Set([
  'weather',
  'client',
  'design',
  'authority',
]);

export function defaultEotCandidate(type: DelayType): boolean {
  return EOT_BY_DEFAULT.has(type);
}

/** Default submit cut-off: 10am the next day in the project's zone (DIA-AC7). */
export const DEFAULT_CUTOFF_TIME = '10:00';

/** The instant after which a submit for `date` counts as late. */
export function lateCutoff(
  date: LocalDate,
  timeZone: string,
  cutoffTime = DEFAULT_CUTOFF_TIME,
): Date {
  return zonedToUtc(addDays(date, 1), cutoffTime, timeZone);
}

export function isLateSubmit(
  submittedAt: Date,
  date: LocalDate,
  timeZone: string,
  cutoffTime?: string,
): boolean {
  return submittedAt.getTime() > lateCutoff(date, timeZone, cutoffTime).getTime();
}

/** A submitted (or signed-off) day only changes through amendments with a reason (X42). */
export function isLocked(status: DiaryStatus): boolean {
  return status !== 'draft';
}

/**
 * Evidential record time for a submit (backend 04 §4): the device's clock when it is plausible, so a diary
 * written on the day stays that day's diary even if it syncs later. A clock ahead of the server is ignored.
 */
export function recordTime(clientAt: Date | undefined, receivedAt: Date): Date {
  if (!clientAt || clientAt.getTime() > receivedAt.getTime()) return receivedAt;
  return clientAt;
}

/** `{field: [before, after]}` for the fields that actually change. */
export function diffChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, [unknown, unknown]> {
  const out: Record<string, [unknown, unknown]> = {};
  for (const [k, after] of Object.entries(patch)) {
    if (after === undefined) continue;
    const prev = before[k] ?? null;
    if (JSON.stringify(prev) !== JSON.stringify(after ?? null)) out[k] = [prev, after ?? null];
  }
  return out;
}

export interface LabourTotals {
  companies: number;
  headcount: number;
  hours: number;
}

/** Live totals for the labour section (DIA-AC3). Blank headcounts count as zero. */
export function labourTotals(
  lines: ReadonlyArray<{ companyId: string; headcount: number | null; hours: number | null }>,
): LabourTotals {
  return {
    companies: new Set(lines.map((l) => l.companyId)).size,
    headcount: lines.reduce((n, l) => n + (l.headcount ?? 0), 0),
    hours: Math.round(lines.reduce((n, l) => n + (l.hours ?? 0), 0) * 100) / 100,
  };
}

/**
 * Yesterday's labour list as today's starting point (DIA-AC3): one line per company and trade, with
 * headcount and hours left blank so nobody files a copied number as fact.
 */
export function copyLabour<T extends { companyId: string; trade: string | null }>(
  lines: readonly T[],
): Array<{ companyId: string; trade: string | null }> {
  const seen = new Set<string>();
  const out: Array<{ companyId: string; trade: string | null }> = [];
  for (const l of lines) {
    const key = `${l.companyId}|${l.trade ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ companyId: l.companyId, trade: l.trade });
  }
  return out;
}

/** Line kinds a company-scoped reader ("read (own labour)", Sam 02 §4) can see, and the column that scopes them. */
export const COMPANY_SCOPED_KINDS: Partial<Record<LineKind, 'companyId'>> = {
  labour: 'companyId',
  plant: 'companyId',
};

/** Line and header fields that hold ids, and the public id kind each one encodes to. */
export const ID_FIELDS = {
  companyId: 'company',
  supplierCompanyId: 'company',
  affectedCompanyIds: 'company',
  fileIds: 'file',
} as const;
