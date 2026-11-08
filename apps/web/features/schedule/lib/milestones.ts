import { daysBetween, type LocalDate } from '@archova/time';
import type { KeyDates } from '../data/api';

export type MilestoneState = 'done' | 'late' | 'next' | 'later';

export interface Milestone {
  id: string;
  label: string;
  /** The date to place it by: the actual date once it has happened, else the target. */
  date: LocalDate;
  state: MilestoneState;
  /** Plain-words position against today, e.g. "in 12 days", "3 days late" or "done 2 days early". */
  note: string;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Key dates as a strip in date order: possession, each section's completion, practical completion, end of defects
 * liability. A milestone is "done" once it has an actual date, "late" when its target has passed without one, and the
 * first not-yet-done milestone on or after today is "next". Possession and end of defects liability have no separate
 * actual date, so possession counts as done once its date has passed and the end of liability is never "late".
 */
export function milestones(k: KeyDates, today: LocalDate): Milestone[] {
  const raw: { id: string; label: string; target: LocalDate | null; actual: LocalDate | null }[] =
    [];
  if (k.possessionDate) {
    const passed = daysBetween(today, k.possessionDate) <= 0;
    raw.push({
      id: 'possession',
      label: 'Site possession',
      target: k.possessionDate,
      actual: passed ? k.possessionDate : null,
    });
  }
  for (const s of k.sections) {
    if (s.targetDate || s.actualDate)
      raw.push({
        id: `section-${s.id}`,
        label: s.name,
        target: s.targetDate,
        actual: s.actualDate,
      });
  }
  if (k.pcTarget || k.pcActual)
    raw.push({ id: 'pc', label: 'Practical completion', target: k.pcTarget, actual: k.pcActual });
  if (k.dlpEnd)
    raw.push({ id: 'dlp', label: 'End of defects liability', target: k.dlpEnd, actual: null });

  const placed = raw
    .map((r) => ({ ...r, date: (r.actual ?? r.target) as LocalDate }))
    .sort((a, b) => a.date.localeCompare(b.date));

  let nextTaken = false;
  return placed.map((r) => {
    const off = daysBetween(today, r.date); // days from today; negative = in the past
    let state: MilestoneState;
    let note: string;
    if (r.actual) {
      state = 'done';
      const early = r.target ? daysBetween(r.actual, r.target) : 0;
      note =
        r.id === 'possession'
          ? 'done'
          : early > 0
            ? `done ${plural(early, 'day')} early`
            : early < 0
              ? `done ${plural(-early, 'day')} late`
              : 'done on target';
    } else if (off < 0 && r.id !== 'dlp') {
      state = 'late';
      note = `${plural(-off, 'day')} late`;
    } else {
      state = !nextTaken ? 'next' : 'later';
      nextTaken = true;
      note = off === 0 ? 'today' : off > 0 ? `in ${plural(off, 'day')}` : 'ended';
    }
    return { id: r.id, label: r.label, date: r.date, state, note };
  });
}
