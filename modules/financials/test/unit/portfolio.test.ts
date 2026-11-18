import { describe, expect, it } from 'vitest';
import { claimDueDate, claimOverdue } from '../../src/domain/portfolio';

const claim = (status: string, scheduleDueOn: string | null, paymentDueOn: string | null) => ({
  status,
  scheduleDueOn,
  paymentDueOn,
});

describe('claim due date and overdue', () => {
  it('uses the schedule date until a schedule is issued, then the payment date', () => {
    expect(claimDueDate(claim('submitted', '2026-11-10', '2026-11-20'))).toBe('2026-11-10');
    expect(claimDueDate(claim('scheduled', '2026-11-10', '2026-11-20'))).toBe('2026-11-20');
  });

  it('is overdue only when open and the relevant date has passed', () => {
    expect(claimOverdue(claim('submitted', '2026-11-04', '2026-11-20'), '2026-11-05')).toBe(true);
    expect(claimOverdue(claim('submitted', '2026-11-05', null), '2026-11-05')).toBe(false);
    expect(claimOverdue(claim('scheduled', '2026-11-01', '2026-11-04'), '2026-11-05')).toBe(true);
    expect(claimOverdue(claim('scheduled', '2026-11-01', '2026-11-30'), '2026-11-05')).toBe(false);
  });

  it('never marks paid or withdrawn claims, or claims with no date, overdue', () => {
    expect(claimOverdue(claim('paid', '2026-01-01', '2026-01-02'), '2026-11-05')).toBe(false);
    expect(claimOverdue(claim('withdrawn', '2026-01-01', '2026-01-02'), '2026-11-05')).toBe(false);
    expect(claimOverdue(claim('submitted', null, null), '2026-11-05')).toBe(false);
  });
});
