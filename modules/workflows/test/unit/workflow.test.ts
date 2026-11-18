import { describe, expect, it } from 'vitest';
import {
  applies,
  checkSteps,
  everyStepHasApprover,
  nextState,
  refusal,
  toCents,
} from '../../src/domain/workflow';

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'b0000000-0000-4000-8000-000000000002';
const C = 'c0000000-0000-4000-8000-000000000003';

describe('checkSteps', () => {
  it('trims names and drops repeated approvers', () => {
    const r = checkSteps([{ name: ' PM ', approverUserIds: [A, A, B] }]);
    expect(r.problems).toEqual([]);
    expect(r.steps).toEqual([{ name: 'PM', approverUserIds: [A, B] }]);
  });

  it('refuses no steps, an unnamed step and a step with nobody to approve it', () => {
    expect(checkSteps([]).problems[0]?.path).toBe('steps');
    const r = checkSteps([{ name: ' ', approverUserIds: [] }]);
    expect(r.problems.map((p) => p.path)).toEqual(['steps/0/name', 'steps/0/approverUserIds']);
  });

  it('refuses one person being the only approver of two steps', () => {
    const r = checkSteps([
      { name: 'PM', approverUserIds: [A] },
      { name: 'Director', approverUserIds: [A] },
    ]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]?.path).toBe('steps/1/approverUserIds');
    expect(
      checkSteps([
        { name: 'PM', approverUserIds: [A] },
        { name: 'Director', approverUserIds: [A, B] },
      ]).problems,
    ).toEqual([]);
  });
});

describe('applies', () => {
  it('applies from the minimum up, and to everything when there is none', () => {
    expect(applies({ minAmountCents: null }, 1)).toBe(true);
    expect(applies({ minAmountCents: 500_000 }, 499_999)).toBe(false);
    expect(applies({ minAmountCents: 500_000 }, 500_000)).toBe(true);
  });
  it('reads dollars as cents', () => {
    expect(toCents('1500.5')).toBe(150_050);
    expect(() => toCents('1,500')).toThrow();
  });
});

describe('who may decide', () => {
  const step = { name: 'PM', approverUserIds: [A, B] };
  it('needs a named approver who is not the submitter or an earlier decider', () => {
    expect(refusal(step, A, C, [])).toBeNull();
    expect(refusal(step, C, C, [])).toBe('own_submission');
    expect(refusal(step, C, A, [])).toBe('not_approver');
    expect(refusal(step, B, C, [B])).toBe('already_decided_earlier');
  });
  it('checks every step has someone other than the submitter', () => {
    expect(everyStepHasApprover([{ name: 'x', approverUserIds: [A, B] }], A)).toBe(true);
    expect(everyStepHasApprover([{ name: 'x', approverUserIds: [A] }], A)).toBe(false);
  });
});

describe('nextState', () => {
  it('moves on, completes on the last approval and ends on any rejection', () => {
    expect(nextState(0, 3, 'approved')).toEqual({ outcome: 'advanced', currentStep: 1 });
    expect(nextState(2, 3, 'approved')).toEqual({ outcome: 'approved', currentStep: null });
    expect(nextState(0, 3, 'rejected')).toEqual({ outcome: 'rejected', currentStep: null });
  });
});
