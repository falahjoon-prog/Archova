// RFI lifecycle (product 03): Draft → Open → Answered → Closed, Void from Open or Answered (reason required),
// Closed → Open on reopen (reason required). Pure, so the screen, the preview source and tests agree.

import type { Rfi, RfiInput, RfiStatus } from './types';

export type RfiAction = 'submit' | 'respond' | 'close' | 'reopen' | 'void';

const ALLOWED: Record<RfiAction, readonly RfiStatus[]> = {
  submit: ['draft'],
  respond: ['open', 'answered'],
  close: ['answered'],
  reopen: ['closed'],
  void: ['open', 'answered'],
};

export function canTransition(status: RfiStatus, action: RfiAction): boolean {
  return ALLOWED[action].includes(status);
}

/** RFI-AC2: subject, question, assignee and due date are required to submit. Returns field → message. */
export function submitErrors(
  input: Pick<RfiInput, 'subject' | 'question' | 'assigneeId' | 'dueDate'>,
): Record<string, string> {
  const e: Record<string, string> = {};
  if (!input.subject.trim()) e.subject = 'Add a subject.';
  if (!input.question.trim()) e.question = 'Write the question.';
  if (!input.assigneeId) e.assigneeId = 'Choose who should answer.';
  if (!input.dueDate) e.dueDate = 'Set a due date.';
  return e;
}

/** Overdue: open with a due date before today (project-local). */
export function isOverdue(rfi: Pick<Rfi, 'status' | 'dueDate'>, today: string): boolean {
  return rfi.status === 'open' && rfi.dueDate !== null && rfi.dueDate < today;
}

/** The primary action for the item header (one ★ per screen). */
export function primaryAction(status: RfiStatus): RfiAction | null {
  switch (status) {
    case 'draft':
      return 'submit';
    case 'open':
      return 'respond';
    case 'answered':
      return 'close';
    case 'closed':
      return 'reopen';
    case 'void':
      return null;
  }
}
