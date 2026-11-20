import { describe, expect, it } from 'vitest';
import { claimTimeline, mostUrgentStep, type TimelineInput } from '../../src/domain/claim-timeline';

// NSW head claim served Wed 14 Oct 2026 (compliance/02 N1): schedule due 28 Oct, payment due 4 Nov.
const base: TimelineInput = {
  ruleState: 'NSW',
  isValid: true,
  servedOn: '2026-10-14',
  scheduleDueOn: '2026-10-28',
  paymentDueOn: '2026-11-04',
  claimedTotalCents: 1_100_000,
  schedule: null,
  paidCents: 0,
  today: '2026-10-20',
  timeZone: 'Australia/Sydney',
};
const step = (t: ReturnType<typeof claimTimeline>, key: string) => t.find((s) => s.key === key);

describe('claimTimeline', () => {
  it('is empty for a claim that is not valid', () => {
    expect(claimTimeline({ ...base, isValid: false, servedOn: null })).toEqual([]);
  });

  it('shows the waiting claim with the schedule and payment ahead', () => {
    const t = claimTimeline(base);
    expect(t.map((s) => s.key)).toEqual(['served', 'schedule', 'payment']);
    expect(step(t, 'schedule')).toMatchObject({ dueOn: '2026-10-28', status: 'upcoming' });
    expect(claimTimeline({ ...base, today: '2026-10-26' }).at(1)?.status).toBe('due_soon');
  });

  it('opens the no-schedule path once the schedule is late (N12 dates)', () => {
    const t = claimTimeline({ ...base, today: '2026-10-30' });
    expect(step(t, 'schedule')).toMatchObject({ status: 'overdue' });
    expect(step(t, 'schedule')?.note).toContain('full claim is likely payable');
    expect(step(t, 'adjudication_notice')).toMatchObject({
      dueOn: '2026-12-02',
      status: 'upcoming',
    });
  });

  it('gives the adjudication window when the schedule was for less (N11)', () => {
    const t = claimTimeline({
      ...base,
      today: '2026-11-09',
      schedule: { issuedAt: new Date('2026-10-28T01:00:00Z'), scheduledCents: 500_000 },
    });
    expect(step(t, 'schedule')).toMatchObject({ status: 'done', doneOn: '2026-10-28' });
    expect(step(t, 'adjudication_schedule_less')).toMatchObject({
      dueOn: '2026-11-11',
      status: 'due_soon',
    });
    expect(step(t, 'adjudication_unpaid')).toBeDefined();
  });

  it('marks a window closed after its last day and drops the unpaid window once paid', () => {
    const schedule = { issuedAt: new Date('2026-10-28T01:00:00Z'), scheduledCents: 1_000_000 };
    const late = claimTimeline({ ...base, today: '2026-12-10', schedule });
    expect(step(late, 'adjudication_unpaid')).toMatchObject({
      dueOn: '2026-12-02',
      status: 'closed',
    });
    const paid = claimTimeline({ ...base, today: '2026-12-10', schedule, paidCents: 1_100_000 });
    expect(step(paid, 'payment')?.status).toBe('done');
    expect(step(paid, 'adjudication_unpaid')).toBeUndefined();
  });

  it('uses the QLD direct window when no schedule was given (Q11 shape)', () => {
    const t = claimTimeline({
      ...base,
      ruleState: 'QLD',
      scheduleDueOn: '2027-02-01',
      paymentDueOn: '2027-01-22',
      servedOn: '2026-12-22',
      today: '2027-02-02',
    });
    expect(step(t, 'adjudication_apply')).toMatchObject({ dueOn: '2027-03-15' });
  });
});

describe('mostUrgentStep', () => {
  it('is null when nothing is due soon or overdue', () => {
    expect(mostUrgentStep(claimTimeline(base))).toBeNull();
  });

  it('picks an overdue step over one that is only due soon', () => {
    // 30 Oct: the schedule (28 Oct) is overdue; the no-schedule notice window is far off.
    expect(mostUrgentStep(claimTimeline({ ...base, today: '2026-10-30' }))).toMatchObject({
      key: 'schedule',
      status: 'overdue',
    });
    expect(mostUrgentStep(claimTimeline({ ...base, today: '2026-10-26' }))).toMatchObject({
      key: 'schedule',
      status: 'due_soon',
    });
  });
});
