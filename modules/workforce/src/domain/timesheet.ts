// Timesheet rules (ATT-US9). Pure, no IO. Hours only: awards, penalty rates and pay stay in payroll.

import type { TimesheetStatus } from '../infra/tables';

export const MAX_DAY_MINUTES = 1440;

/** Hours are changed only while the worker or supervisor is still getting them right. */
export function isEditable(status: TimesheetStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

export interface LineHours {
  minutes: number;
  breakMinutes: number;
}

export function totals(lines: readonly LineHours[]): {
  totalMinutes: number;
  breakMinutes: number;
} {
  let totalMinutes = 0;
  let breakMinutes = 0;
  for (const l of lines) {
    totalMinutes += l.minutes;
    breakMinutes += l.breakMinutes;
  }
  return { totalMinutes, breakMinutes };
}

/** A person cannot be on site for more than a day, and a break is part of the time worked. */
export function dayProblem(lines: readonly LineHours[]): 'day_too_long' | 'break_too_long' | null {
  const t = totals(lines);
  if (t.totalMinutes > MAX_DAY_MINUTES) return 'day_too_long';
  if (lines.some((l) => l.breakMinutes > l.minutes)) return 'break_too_long';
  return null;
}

/** What each transition needs the timesheet to be, and what it becomes. */
export const TRANSITIONS = {
  submit: { from: ['draft', 'rejected'], to: 'submitted' },
  approve: { from: ['submitted'], to: 'approved' },
  reject: { from: ['submitted', 'approved'], to: 'rejected' },
} as const satisfies Record<string, { from: readonly TimesheetStatus[]; to: TimesheetStatus }>;
