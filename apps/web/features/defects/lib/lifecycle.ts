// Defect lifecycle (product 06): Draft → Open → Ready for inspection → Closed, Ready → Open on reject (reason),
// Closed → Open on reopen (reason; the final approver's call). Open → Disputed when the subbie says it isn't theirs, Disputed → Open on reassign, Void with a reason.

import type { ApiDefectAction, Defect, DefectInput, DefectStatus } from './types';

export type DefectAction =
  'issue' | 'ready' | 'close' | 'reject' | 'dispute' | 'reassign' | 'void' | 'reopen';

const ALLOWED: Record<DefectAction, readonly DefectStatus[]> = {
  issue: ['draft'],
  ready: ['open'],
  close: ['ready_for_review'],
  reject: ['ready_for_review'],
  dispute: ['open'],
  reassign: ['open', 'disputed'],
  void: ['draft', 'open', 'disputed', 'ready_for_review'],
  reopen: ['closed'],
};

export function canDefect(status: DefectStatus, action: DefectAction): boolean {
  return ALLOWED[action].includes(status);
}

const API_ACTION: Record<DefectAction, ApiDefectAction> = {
  issue: 'issue',
  ready: 'markReadyForReview',
  close: 'close',
  reject: 'reject',
  dispute: 'dispute',
  reassign: 'reassign',
  void: 'void',
  reopen: 'reopen',
};

/** Whether to offer an action: the API says so per caller; preview data falls back to the status table. */
export function defectCan(
  d: Pick<Defect, 'status' | 'availableActions'>,
  action: DefectAction,
): boolean {
  return d.availableActions
    ? d.availableActions.includes(API_ACTION[action])
    : canDefect(d.status, action);
}

/** Required to raise: title, a responsible company, and a location or a drawing pin (DEF-AC3, DEF-AC4). */
export function defectInputErrors(
  input: DefectInput,
  /** The server stores a drawing pin and no location, so a pin is required against it. */
  pinRequired = false,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.title.trim()) e.title = 'Add a short title.';
  if (!input.assigneeCompanyId) e.assigneeCompanyId = 'Choose the responsible company.';
  if (pinRequired) {
    if (!input.drawing) e.location = 'Choose the drawing and mark where the defect is.';
  } else if (!input.locationId && !input.drawing) {
    e.location = 'Choose a location or a drawing.';
  }
  return e;
}

export function isDefectOverdue(
  d: Pick<Defect, 'status' | 'dueDate'> & { isOverdue?: boolean | null },
  today: string,
): boolean {
  if (d.isOverdue !== undefined && d.isOverdue !== null) return d.isOverdue;
  return (
    (d.status === 'open' || d.status === 'disputed') && d.dueDate !== null && d.dueDate < today
  );
}
