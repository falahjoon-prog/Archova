// Pure delay register rules (product/08 SCH-AC2): turns diary delay lines and RFI time impacts into one list.
import { daysBetween, localDateOf, type LocalDate } from '@archova/time';

export const DELAY_CAUSES = [
  'weather',
  'client',
  'design',
  'subcontractor',
  'authority',
  'industrial',
  'other',
] as const;
export type DelayCause = (typeof DELAY_CAUSES)[number];

export interface DiaryDelayInput {
  id: string;
  date: LocalDate;
  status: 'draft' | 'submitted' | 'signed_off';
  type: DelayCause;
  description: string;
  hours: number;
  isEotCandidate: boolean;
}

export interface RfiImpactInput {
  id: string;
  number: number | null;
  subject: string;
  status: string;
  dueDate: LocalDate | null;
  openedAt: Date | null;
  answeredAt: Date | null;
  scheduleImpactDays: number | null;
}

export interface RegisterRow {
  id: string;
  source: 'diary' | 'rfi';
  kind: 'diary_delay' | 'rfi_schedule_impact' | 'rfi_late_answer';
  cause: DelayCause;
  date: LocalDate;
  title: string;
  days: number | null;
  hours: number | null;
  possibleEot: boolean;
  diaryDate: LocalDate | null;
  diaryStatus: DiaryDelayInput['status'] | null;
  rfiId: string | null;
  rfiNumber: number | null;
}

const rfiLabel = (r: RfiImpactInput) =>
  `${r.number !== null ? `RFI-${String(r.number).padStart(3, '0')}` : 'RFI'} ${r.subject}`;

export function diaryRow(d: DiaryDelayInput, publicId: string): RegisterRow {
  return {
    id: `diary:${publicId}`,
    source: 'diary',
    kind: 'diary_delay',
    cause: d.type,
    date: d.date,
    title: d.description,
    days: null,
    hours: d.hours,
    possibleEot: d.isEotCandidate,
    diaryDate: d.date,
    diaryStatus: d.status,
    rfiId: null,
    rfiNumber: null,
  };
}

/**
 * Up to two rows per RFI: the schedule impact the author recorded, and the days it took past its due date (an open RFI
 * counts until today). Both are design information, so both are possible EOT (the diary's default for design delays).
 */
export function rfiRows(
  r: RfiImpactInput,
  publicId: string,
  today: LocalDate,
  timeZone: string,
): RegisterRow[] {
  const base = {
    source: 'rfi' as const,
    cause: 'design' as const,
    title: rfiLabel(r),
    hours: null,
    possibleEot: true,
    diaryDate: null,
    diaryStatus: null,
    rfiId: publicId,
    rfiNumber: r.number,
  };
  const out: RegisterRow[] = [];
  if ((r.scheduleImpactDays ?? 0) > 0)
    out.push({
      ...base,
      id: `rfi-impact:${publicId}`,
      kind: 'rfi_schedule_impact',
      date: r.openedAt ? localDateOf(r.openedAt, timeZone) : (r.dueDate ?? today),
      days: r.scheduleImpactDays,
    });
  if (r.dueDate) {
    const answered = r.answeredAt ? localDateOf(r.answeredAt, timeZone) : null;
    const until = answered ?? (r.status === 'open' ? today : null);
    const late = until ? daysBetween(r.dueDate, until) : 0;
    if (late > 0)
      out.push({
        ...base,
        id: `rfi-late:${publicId}`,
        kind: 'rfi_late_answer',
        date: r.dueDate,
        days: late,
      });
  }
  return out;
}

export interface RegisterFilter {
  from?: LocalDate;
  to?: LocalDate;
  cause?: DelayCause;
  source?: 'diary' | 'rfi';
  eotOnly?: boolean;
}

export function filterRows(rows: RegisterRow[], f: RegisterFilter): RegisterRow[] {
  return rows.filter(
    (r) =>
      (!f.from || r.date >= f.from) &&
      (!f.to || r.date <= f.to) &&
      (!f.cause || r.cause === f.cause) &&
      (!f.source || r.source === f.source) &&
      (!f.eotOnly || r.possibleEot),
  );
}

/** Newest day first; ties by id so the order is stable. */
export function sortRows(rows: RegisterRow[]): RegisterRow[] {
  return [...rows].sort((a, b) =>
    a.date === b.date ? (a.id < b.id ? 1 : -1) : a.date < b.date ? 1 : -1,
  );
}

export function totals(rows: readonly RegisterRow[]) {
  return {
    rows: rows.length,
    possibleEotRows: rows.filter((r) => r.possibleEot).length,
    diaryHours: Math.round(rows.reduce((n, r) => n + (r.hours ?? 0), 0) * 100) / 100,
    rfiDays: rows.reduce((n, r) => n + (r.source === 'rfi' ? (r.days ?? 0) : 0), 0),
  };
}
