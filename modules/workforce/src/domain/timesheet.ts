// Timesheets: pure rules. Use cases live in application/timesheet.

export type SheetState = 'draft' | 'submitted' | 'approved' | 'rejected' | 'exported';

/** Hours can be changed only before a supervisor has approved them; a rejection reopens the sheet. */
export const editable = (s: SheetState) => s === 'draft' || s === 'rejected';

const MOVES: Record<SheetState, SheetState[]> = {
  draft: ['submitted'],
  rejected: ['submitted'],
  submitted: ['approved', 'rejected'],
  approved: ['exported'],
  exported: [],
};
export const canMove = (from: SheetState, to: SheetState) => MOVES[from].includes(to);

/** Paid time on a line: the time worked less the unpaid break. */
export const payable = (l: { minutes: number; breakMinutes: number }) =>
  Math.max(l.minutes - l.breakMinutes, 0);

export const totalMinutes = (lines: { minutes: number; breakMinutes: number }[]) =>
  lines.reduce((sum, l) => sum + payable(l), 0);

/** Hours as a two decimal string, e.g. 450 minutes is `7.50`. */
export const hoursOf = (minutes: number) => (minutes / 60).toFixed(2);

/**
 * One CSV cell. Quoted when it holds a comma, quote or line break; a cell that starts with `=`, `+`, `-` or `@`
 * is prefixed so a spreadsheet can't read it as a formula.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const csvLine = (cells: string[]) => cells.map(csvCell).join(',');
