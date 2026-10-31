import { describe, expect, it } from 'vitest';
import { deadlineState } from '../lib/deadline';

const claim = (over: Partial<Parameters<typeof deadlineState>[0]> = {}) => ({
  scheduleDueOn: '2026-10-28',
  status: 'submitted' as const,
  isValid: true,
  ...over,
});

describe('deadlineState (CLM-AC3)', () => {
  it('is ok with more than 3 business days left, warns at 3, danger at 1', () => {
    expect(deadlineState(claim(), '2026-10-20')).toMatchObject({ state: 'ok', businessDays: 6 });
    expect(deadlineState(claim(), '2026-10-23')).toMatchObject({
      state: 'warning',
      businessDays: 3,
    });
    expect(deadlineState(claim(), '2026-10-27')).toMatchObject({
      state: 'danger',
      businessDays: 1,
    });
    expect(deadlineState(claim(), '2026-10-28')).toMatchObject({
      state: 'danger',
      businessDays: 0,
    });
  });

  it('says the deadline has passed only while no schedule has been issued', () => {
    expect(deadlineState(claim(), '2026-10-29').state).toBe('passed');
    expect(deadlineState(claim({ status: 'scheduled' }), '2026-10-29').state).toBe('done');
  });

  it('has no deadline for a claim that is not valid', () => {
    expect(deadlineState(claim({ isValid: false, scheduleDueOn: null }), '2026-10-20').state).toBe(
      'none',
    );
  });
});
