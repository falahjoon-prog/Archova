import { describe, expect, it } from 'vitest';
import { canTransition, isOverdue, primaryAction, submitErrors } from '../lib/lifecycle';
import { formatRfiNumber } from '../lib/types';

describe('RFI lifecycle', () => {
  it('allows only the documented transitions', () => {
    expect(canTransition('draft', 'submit')).toBe(true);
    expect(canTransition('open', 'close')).toBe(false);
    expect(canTransition('answered', 'close')).toBe(true);
    expect(canTransition('closed', 'reopen')).toBe(true);
    expect(canTransition('closed', 'void')).toBe(false);
    expect(canTransition('void', 'reopen')).toBe(false);
  });

  it('requires subject, question, assignee and due date to submit (RFI-AC2)', () => {
    expect(
      Object.keys(submitErrors({ subject: ' ', question: '', assigneeId: null, dueDate: null })),
    ).toEqual(['subject', 'question', 'assigneeId', 'dueDate']);
    expect(
      submitErrors({ subject: 'S', question: 'Q', assigneeId: 'usr_eng', dueDate: '2026-10-09' }),
    ).toEqual({});
  });

  it('is overdue only while open and past the due date', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-10-01' }, '2026-10-02')).toBe(true);
    expect(isOverdue({ status: 'open', dueDate: '2026-10-02' }, '2026-10-02')).toBe(false);
    expect(isOverdue({ status: 'answered', dueDate: '2026-09-01' }, '2026-10-02')).toBe(false);
  });

  it('has one primary action per status and formats numbers', () => {
    expect(primaryAction('open')).toBe('respond');
    expect(primaryAction('void')).toBeNull();
    expect(formatRfiNumber(7)).toBe('RFI-007');
    expect(formatRfiNumber(null)).toBe('Draft');
  });
});
