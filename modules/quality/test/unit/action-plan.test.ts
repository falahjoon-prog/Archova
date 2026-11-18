import { describe, expect, it } from 'vitest';
import { actionPlanLabel, derivePlanStatus } from '../../src/domain/action-plan';

describe('action plan rules', () => {
  it('numbers plans AP-0001', () => expect(actionPlanLabel(7)).toBe('AP-0007'));

  it('completes when every step is done or skipped, and only then', () => {
    expect(derivePlanStatus('active', [])).toBe('active');
    expect(derivePlanStatus('active', [{ status: 'done' }, { status: 'open' }])).toBe('active');
    expect(derivePlanStatus('active', [{ status: 'done' }, { status: 'skipped' }])).toBe(
      'completed',
    );
    expect(derivePlanStatus('completed', [{ status: 'done' }, { status: 'open' }])).toBe('active');
  });

  it('keeps a cancelled plan cancelled whatever its steps do', () => {
    expect(derivePlanStatus('cancelled', [{ status: 'done' }])).toBe('cancelled');
  });
});
