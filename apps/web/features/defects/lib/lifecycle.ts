// Defect lifecycle (product 06): Draft → Open → Ready for inspection → Closed, Ready → Open on reject (reason),
// Open → Disputed when the subbie says it isn't theirs, Disputed → Open on reassign, Void with a reason.

import type { ApiDefectAction, Defect, DefectInput, DefectStatus } from './types';

export type DefectAction = 'issue' | 'ready' | 'close' | 'reject' | 'dispute' | 'reassign' | 'void';

const ALLOWED: Record<DefectAction, readonly DefectStatus[]> = {
  issue: ['draft'],
  ready: ['open'],
  close: ['ready_for_review'],
  reject: ['ready_for_review'],
  dispute: ['open'],
  reassign: ['open', 'disputed'],
  void: ['draft', 'open', 'disputed', 'ready_for_review'],
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
  /** Against the server a location from the project's tree or a drawing pin will do, as in preview. */
  live = false,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.title.trim()) e.title = 'Add a short title.';
  if (!input.assigneeCompanyId) e.assigneeCompanyId = 'Choose the responsible company.';
  if (!input.locationId && !input.drawing)
    e.location = live
      ? 'Choose a location, or choose the drawing and mark where the defect is.'
      : 'Choose a location or a drawing.';
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
