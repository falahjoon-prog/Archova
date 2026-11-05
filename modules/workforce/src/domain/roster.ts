// Rosters: shifts at a site, workers assigned to them (ATT-US11). Pure rules; the use cases live in application/roster.

export type ShiftState = 'draft' | 'published' | 'cancelled';
export type AssignmentState = 'offered' | 'accepted' | 'declined' | 'no_show' | 'attended';

/** Do two half-open time ranges overlap? A shift ending at 15:00 and another starting at 15:00 do not. */
export const overlaps = (
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Workers still counted against a shift's headcount: those who have not declined. */
export const filled = (states: AssignmentState[]) => states.filter((s) => s !== 'declined').length;

/**
 * What a worker (or their company) may answer, and what only a site manager may record afterwards. Attendance
 * outcomes are the manager's call, and only once the shift has begun and the worker had accepted or was still offered.
 */
export function canMove(
  from: AssignmentState,
  to: AssignmentState,
  by: 'worker' | 'manager',
  shiftStarted: boolean,
): boolean {
  if (to === 'accepted' || to === 'declined')
    return (from === 'offered' || from === 'accepted' || from === 'declined') && from !== to;
  if (to === 'attended' || to === 'no_show')
    return by === 'manager' && shiftStarted && from !== 'declined' && from !== to;
  return false;
}
