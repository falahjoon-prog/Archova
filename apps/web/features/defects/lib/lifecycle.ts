// Defect lifecycle (product 06): Draft → Open → Ready for inspection → Closed, Ready → Open on reject (reason),
// Open → Disputed when the subbie says it isn't theirs, Disputed → Open on reassign, Void with a reason.

import type { Defect, DefectInput, DefectStatus } from './types';

export type DefectAction = 'ready' | 'close' | 'reject' | 'dispute' | 'reassign' | 'void';

const ALLOWED: Record<DefectAction, readonly DefectStatus[]> = {
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

/** Required to raise: title, a responsible company, and a location or a drawing pin (DEF-AC3, DEF-AC4). */
export function defectInputErrors(input: DefectInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.title.trim()) e.title = 'Add a short title.';
  if (!input.assigneeCompanyId) e.assigneeCompanyId = 'Choose the responsible company.';
  if (!input.locationId && !input.drawing) e.location = 'Choose a location or a drawing.';
  return e;
}

export function isDefectOverdue(d: Pick<Defect, 'status' | 'dueDate'>, today: string): boolean {
  return (
    (d.status === 'open' || d.status === 'disputed') && d.dueDate !== null && d.dueDate < today
  );
}
