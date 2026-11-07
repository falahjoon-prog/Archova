import { addDays, endOfLocalDay, startOfLocalDay, type LocalDate } from '@archova/time';

export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  exported: 'Exported',
};
export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s;

/** "7.50 h" (the server already formats paidHours to two places). */
export const hoursText = (paidHours: string) => `${paidHours} h`;

export function sheetSubtitle(s: { date: string; status: string; paidHours: string }): string {
  return `${s.date}, ${hoursText(s.paidHours)}, ${statusLabel(s.status)}`;
}

/** The last two weeks ending today, as project-local days. */
export const defaultRange = (today: LocalDate) => ({ from: addDays(today, -13), to: today });

export interface CheckSession {
  workerId: string;
  minutes: number | null;
  status: string;
}
export interface CheckShift {
  status: string;
  startsAt: string;
  assignments: { workerId: string; status: string }[];
}
export interface Flag {
  code: 'no_sign_in' | 'more_than_signed_in' | 'auto_closed' | 'not_on_roster' | 'open_session';
  message: string;
}

/** How far paid time may run over signed-in time before it is flagged (rounding and break edits). */
export const TOLERANCE_MINUTES = 15;

/**
 * Rule-based Nova check for a timesheet before a supervisor approves it: do the hours match what the worker's
 * site sign-ins and roster say for the day? Nothing here approves or blocks; it only explains (principle P6).
 */
export function timesheetFlags(
  sheet: { workerId: string; paidMinutes: number },
  sessions: readonly CheckSession[],
  shifts: readonly CheckShift[],
): Flag[] {
  if (sheet.paidMinutes <= 0) return [];
  const flags: Flag[] = [];
  const mine = sessions.filter((s) => s.workerId === sheet.workerId);
  const signed = mine.reduce((sum, s) => sum + (s.minutes ?? 0), 0);
  if (mine.length === 0) {
    flags.push({
      code: 'no_sign_in',
      message: `${(sheet.paidMinutes / 60).toFixed(2)} h claimed but no site sign-in that day.`,
    });
  } else {
    if (mine.some((s) => s.minutes === null)) {
      flags.push({
        code: 'open_session',
        message: 'A sign-in has no sign-out yet, so signed-in time is incomplete.',
      });
    }
    if (sheet.paidMinutes > signed + TOLERANCE_MINUTES) {
      flags.push({
        code: 'more_than_signed_in',
        message: `Paid ${(sheet.paidMinutes / 60).toFixed(2)} h but signed in ${(signed / 60).toFixed(2)} h.`,
      });
    }
    if (mine.some((s) => s.status === 'auto_closed')) {
      flags.push({
        code: 'auto_closed',
        message: 'A sign-out was added automatically at day end, so hours are not exact.',
      });
    }
  }
  const rostered = shifts.some(
    (sh) =>
      sh.status === 'published' &&
      sh.assignments.some((a) => a.workerId === sheet.workerId && a.status !== 'declined'),
  );
  if (!rostered)
    flags.push({ code: 'not_on_roster', message: 'Not on a published roster shift that day.' });
  return flags;
}

/** The UTC instants of the project-local day: shifts starting inside it are the day's roster. */
export function dayWindow(date: LocalDate, zone: string): { from: string; to: string } {
  return {
    from: startOfLocalDay(date, zone).toISOString(),
    to: endOfLocalDay(date, zone).toISOString(),
  };
}
