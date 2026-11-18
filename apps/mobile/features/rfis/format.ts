export const STATUS_TEXT: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  void: 'Void',
};

export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s;

export type RfiFilter = 'all' | 'mine' | 'overdue';

/** "RFI-007, Open, with the assignees, overdue" */
export function rfiSubtitle(r: {
  numberLabel: string | null;
  status: string;
  ballInCourt: { side: string | null };
  isOverdue: boolean;
  dueDate: string | null;
}): string {
  const side =
    r.ballInCourt.side === 'assignees'
      ? 'with the assignees'
      : r.ballInCourt.side === 'builder'
        ? 'with the builder'
        : null;
  return [
    r.numberLabel ?? 'Not numbered yet',
    statusLabel(r.status),
    side,
    r.isOverdue ? 'overdue' : r.dueDate ? `due ${r.dueDate}` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

/** The caller may answer an open RFI when the ball is with the assignees. The server decides who really can. */
export function canRespond(r: { status: string; ballInCourt: { side: string | null } }): boolean {
  return r.status === 'open' && r.ballInCourt.side === 'assignees';
}
