// Plant and equipment rules: allocation clashes, maintenance due dates, utilisation and the rule-based Nova flags.
// Pure functions over plain rows; the use cases in application/plant load the rows. Dates are `YYYY-MM-DD` local dates.
import { addDays, daysBetween } from '@archova/time';

export const ASSET_CATEGORIES = [
  'crane',
  'excavator',
  'loader',
  'truck',
  'generator',
  'access_platform',
  'compaction',
  'lighting',
  'other',
] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];
export type Ownership = 'owned' | 'hired';
export type AssetStatus = 'active' | 'maintenance' | 'retired';
export type PlanKind = 'service' | 'inspection' | 'certification';

export interface Span {
  startsOn: string;
  endsOn: string;
}

/** Days a due date counts as "due soon" before it, by kind. Certificates need longer to renew. */
export const DUE_SOON_DAYS: Record<PlanKind, number> = {
  service: 14,
  inspection: 14,
  certification: 30,
};
/** An asset with no allocation for this many days is flagged idle unless the caller asks for another number. */
export const DEFAULT_IDLE_DAYS = 14;

/** Do two inclusive date ranges share a day? One ending on the 5th and one starting on the 5th do. */
export const spansOverlap = (a: Span, b: Span) => a.startsOn <= b.endsOn && b.startsOn <= a.endsOn;

/** Days in an inclusive range. */
export const spanDays = (s: Span) => daysBetween(s.startsOn, s.endsOn) + 1;

/** Only machines in service can be allocated; one in the workshop or retired can't. */
export const allocatable = (status: AssetStatus) => status === 'active';

export type DueState = 'ok' | 'due_soon' | 'overdue';

/** Where a due date stands today. A date before today is overdue; today itself is due soon, not overdue. */
export function dueState(nextDueOn: string, today: string, kind: PlanKind): DueState {
  const days = daysBetween(today, nextDueOn);
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS[kind] ? 'due_soon' : 'ok';
}

/** The next due date after finishing a plan on `doneOn`: that day plus the interval, or none for a one-off. */
export const nextDueAfter = (doneOn: string, intervalDays: number | null) =>
  intervalDays ? addDays(doneOn, intervalDays) : null;

/**
 * Booked days of one machine inside `[from, to]`: the days covered by at least one active allocation, counted once
 * even when allocations overlap (which the booking path prevents but imported data may not).
 */
export function bookedDays(allocations: readonly Span[], window: Span): number {
  const clipped = allocations
    .map((a) => ({
      startsOn: a.startsOn < window.startsOn ? window.startsOn : a.startsOn,
      endsOn: a.endsOn > window.endsOn ? window.endsOn : a.endsOn,
    }))
    .filter((a) => a.startsOn <= a.endsOn)
    .sort((x, y) => (x.startsOn < y.startsOn ? -1 : x.startsOn > y.startsOn ? 1 : 0));
  let total = 0;
  let end: string | null = null;
  for (const a of clipped) {
    if (end === null || a.startsOn > end) {
      total += spanDays(a);
      end = a.endsOn;
    } else if (a.endsOn > end) {
      total += daysBetween(end, a.endsOn);
      end = a.endsOn;
    }
  }
  return total;
}

/** Share of the window's days a machine is allocated, as a whole percentage. */
export function utilisationPct(allocations: readonly Span[], window: Span): number {
  return Math.round((bookedDays(allocations, window) / spanDays(window)) * 100);
}

export interface FlagAsset {
  id: string;
  name: string;
  assetNumber: string;
  ownership: Ownership;
  status: AssetStatus;
  dailyRateCents: number | null;
  /** Local date the asset was added; idle time is counted from it when it has never been allocated. */
  createdOn: string;
}
export interface FlagAllocation extends Span {
  id: string;
  assetId: string;
  projectId: string;
}
export interface FlagPlan {
  id: string;
  assetId: string;
  title: string;
  kind: PlanKind;
  nextDueOn: string | null;
}

export type FlagCode =
  | 'maintenance_overdue'
  | 'maintenance_due_soon'
  | 'certification_expired'
  | 'certification_expiring'
  | 'double_booking'
  | 'booked_while_unavailable'
  | 'service_during_booking'
  | 'idle';
export type FlagSeverity = 'critical' | 'warning' | 'info';

export interface PlantFlag {
  code: FlagCode;
  severity: FlagSeverity;
  assetId: string;
  /** The plan or allocation the flag is about, when it is about one. */
  subjectId: string | null;
  message: string;
  /** The date that matters (the due date, the clash start, or the day the idle spell began). */
  date: string | null;
}

const label = (a: FlagAsset) => `${a.name} (${a.assetNumber})`;
const dollars = (cents: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(cents / 100);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The flags Nova raises for the fleet. Rule-based, no model: overdue or soon-due maintenance and certificates, two
 * allocations of one machine on the same day, a machine allocated while it is in the workshop or retired, a service
 * that falls inside a booking, and a machine that has sat unallocated for `idleDays` or more. Retired machines raise
 * nothing. Most urgent first, then by date.
 */
export function computeFlags(input: {
  assets: readonly FlagAsset[];
  allocations: readonly FlagAllocation[];
  plans: readonly FlagPlan[];
  today: string;
  idleDays?: number;
}): PlantFlag[] {
  const idleDays = input.idleDays ?? DEFAULT_IDLE_DAYS;
  const flags: PlantFlag[] = [];
  const live = input.assets.filter((a) => a.status !== 'retired');

  for (const asset of live) {
    const allocs = input.allocations
      .filter((a) => a.assetId === asset.id)
      .sort((x, y) => (x.startsOn < y.startsOn ? -1 : x.startsOn > y.startsOn ? 1 : 0));

    for (const p of input.plans) {
      if (p.assetId !== asset.id || !p.nextDueOn) continue;
      const state = dueState(p.nextDueOn, input.today, p.kind);
      if (state === 'ok') continue;
      const days = daysBetween(input.today, p.nextDueOn);
      const cert = p.kind === 'certification';
      const when =
        days < 0
          ? `${plural(-days, 'day')} overdue`
          : days === 0
            ? 'due today'
            : `due in ${plural(days, 'day')}`;
      flags.push({
        code:
          state === 'overdue'
            ? cert
              ? 'certification_expired'
              : 'maintenance_overdue'
            : cert
              ? 'certification_expiring'
              : 'maintenance_due_soon',
        severity: state === 'overdue' ? 'critical' : 'warning',
        assetId: asset.id,
        subjectId: p.id,
        message: `${label(asset)}: ${p.title} ${cert && days < 0 ? `expired ${plural(-days, 'day')} ago` : when}.`,
        date: p.nextDueOn,
      });
      // A service that falls inside a booking needs the booking moved or the service brought forward.
      const clash = allocs.find((a) => p.nextDueOn! >= a.startsOn && p.nextDueOn! <= a.endsOn);
      if (clash && p.nextDueOn >= input.today && p.kind !== 'certification')
        flags.push({
          code: 'service_during_booking',
          severity: 'info',
          assetId: asset.id,
          subjectId: p.id,
          message: `${label(asset)}: ${p.title} falls on ${p.nextDueOn}, inside a booking from ${clash.startsOn} to ${clash.endsOn}.`,
          date: p.nextDueOn,
        });
    }

    // Double bookings: report each overlapping pair once, at the first shared day.
    for (let i = 0; i < allocs.length; i++)
      for (let j = i + 1; j < allocs.length; j++) {
        const a = allocs[i]!;
        const b = allocs[j]!;
        if (b.startsOn > a.endsOn) break;
        flags.push({
          code: 'double_booking',
          severity: 'critical',
          assetId: asset.id,
          subjectId: b.id,
          message: `${label(asset)} is booked twice from ${b.startsOn}.`,
          date: b.startsOn,
        });
      }

    if (asset.status === 'maintenance') {
      const upcoming = allocs.filter((a) => a.endsOn >= input.today);
      if (upcoming.length > 0)
        flags.push({
          code: 'booked_while_unavailable',
          severity: 'warning',
          assetId: asset.id,
          subjectId: upcoming[0]!.id,
          message: `${label(asset)} is in the workshop but has ${plural(upcoming.length, 'booking')} still to come.`,
          date: upcoming[0]!.startsOn,
        });
    } else {
      // Idle: not allocated today or later, and the last allocation ended `idleDays` or more ago.
      const busy = allocs.some((a) => a.endsOn >= input.today);
      if (!busy) {
        const lastEnd = allocs.reduce<string | null>(
          (m, a) => (m === null || a.endsOn > m ? a.endsOn : m),
          null,
        );
        const since = lastEnd ? addDays(lastEnd, 1) : asset.createdOn;
        const idle = daysBetween(since, input.today);
        if (idle >= idleDays) {
          const cost =
            asset.dailyRateCents && asset.dailyRateCents > 0
              ? asset.ownership === 'hired'
                ? ` At ${dollars(asset.dailyRateCents)} a day, consider off-hiring it.`
                : ` Carrying cost ${dollars(asset.dailyRateCents)} a day.`
              : '';
          flags.push({
            code: 'idle',
            severity: 'info',
            assetId: asset.id,
            subjectId: null,
            message: `${label(asset)} has been idle for ${plural(idle, 'day')}.${cost}`,
            date: since,
          });
        }
      }
    }
  }

  const rank: Record<FlagSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return flags.sort(
    (x, y) =>
      rank[x.severity] - rank[y.severity] ||
      (x.date ?? '').localeCompare(y.date ?? '') ||
      x.assetId.localeCompare(y.assetId),
  );
}
