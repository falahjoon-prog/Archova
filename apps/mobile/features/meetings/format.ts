/** "Due 12 Nov", or "Overdue, was due 12 Nov". Dates are project-local days, so no zone maths here. */
export function dueText(dueDate: string | null, isOverdue: boolean): string {
  if (!dueDate) return 'No due date';
  const [y, m, d] = dueDate.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return isOverdue ? `Overdue, was due ${day}` : `Due ${day}`;
}

export const carriedText = (n: number) =>
  n === 0 ? null : n === 1 ? 'Carried forward once' : `Carried forward ${n} times`;

export const KIND_TEXT = { information: 'Information', decision: 'Decision', action: 'Action' };

/** One line for a meeting row: number, when it was held, and what is waiting. */
export function meetingSubtitle(m: {
  number: number;
  heldAt: string;
  status: 'draft' | 'issued';
  openActions: number;
}): string {
  const held = new Date(m.heldAt).toLocaleDateString('en-AU', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const open =
    m.openActions > 0
      ? `, ${m.openActions} open ${m.openActions === 1 ? 'action' : 'actions'}`
      : '';
  return `Meeting ${m.number}, ${held}${m.status === 'draft' ? ', not issued' : ''}${open}`;
}
