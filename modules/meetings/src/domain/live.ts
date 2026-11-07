// Live agenda sections (product/07 MTG-US5, AC6): a section whose list comes from a register. Pure, no IO.
import { addDays, isoWeekday, type LocalDate } from '@archova/time';

export const LIVE_SOURCES = [
  'rfis_overdue',
  'submittals_due',
  'defects_open',
  'delays_week',
] as const;
export type LiveSource = (typeof LIVE_SOURCES)[number];

/** The section title a live source starts with, when the person doesn't give one. */
export const LIVE_TITLES: Record<LiveSource, string> = {
  rfis_overdue: 'Overdue RFIs',
  submittals_due: 'Submittals due',
  defects_open: 'Open defects by trade',
  delays_week: 'Delays this week',
};

/** Most rows one live section lists; past it the section says the list was cut. */
export const LIVE_LIMIT = 50;

export type LiveLinkType = 'rfi' | 'defect' | 'submittal';

export interface LiveRow {
  /** The record's own number: RFI-012, a defect label, a submittal number, the day for a delay. */
  ref: string;
  title: string;
  detail: string;
  /** Public id of the record, for a link; null for a diary delay line. */
  link: { type: LiveLinkType; id: string } | null;
}

/** The list as it stood: what the screen shows while the minutes are a draft, and what issuing freezes (AC6). */
export interface LiveSnapshot {
  source: LiveSource;
  asOf: string;
  rows: LiveRow[];
  truncated: boolean;
  /** The reader can't see this register, so the list is empty because of access, not because nothing is due. */
  restricted: boolean;
}

/** Monday to Sunday of the week `today` falls in. */
export function weekOf(today: LocalDate): { from: LocalDate; to: LocalDate } {
  const from = addDays(today, -(isoWeekday(today) - 1));
  return { from, to: addDays(from, 6) };
}

export const isLiveSource = (v: unknown): v is LiveSource =>
  typeof v === 'string' && (LIVE_SOURCES as readonly string[]).includes(v);
