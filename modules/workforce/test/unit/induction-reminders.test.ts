import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@archova/time';
import {
  daysToExpiry,
  isExpiringSoon,
  reminderText,
  reminderThreshold,
} from '../../src/domain/induction';
import {
  planInductionReminders,
  type InductionReminderCandidate,
} from '../../src/application/induction-reminders';

const d = (s: string) => s as LocalDate;

describe('reminderThreshold', () => {
  it('is quiet more than 30 days out and when there is no expiry', () => {
    expect(reminderThreshold('2026-12-22', d('2026-11-21'))).toBeNull();
    expect(reminderThreshold(null, d('2026-11-21'))).toBeNull();
  });
  it('steps 30, 7, 0 as expiry nears and stays 0 once past', () => {
    expect(reminderThreshold('2026-12-21', d('2026-11-21'))).toBe(30);
    expect(reminderThreshold('2026-11-28', d('2026-11-21'))).toBe(7);
    expect(reminderThreshold('2026-11-21', d('2026-11-21'))).toBe(0);
    expect(reminderThreshold('2026-01-01', d('2026-11-21'))).toBe(0);
  });
});

describe('expiry helpers', () => {
  it('counts whole days, negative once expired', () => {
    expect(daysToExpiry('2026-11-30', d('2026-11-21'))).toBe(9);
    expect(daysToExpiry('2026-11-20', d('2026-11-21'))).toBe(-1);
    expect(daysToExpiry(null, d('2026-11-21'))).toBeNull();
  });
  it('flags only a current induction that lapses within 30 days', () => {
    expect(isExpiringSoon('current', '2026-12-10', d('2026-11-21'))).toBe(true);
    expect(isExpiringSoon('current', '2027-06-01', d('2026-11-21'))).toBe(false);
    expect(isExpiringSoon('expired', '2026-11-01', d('2026-11-21'))).toBe(false);
    expect(isExpiringSoon('not_inducted', null, d('2026-11-21'))).toBe(false);
  });
  it('words reminders for the worker and for the supervisor', () => {
    expect(reminderText('Sam', 7, '2026-11-28', 'worker').title).toBe(
      'Your site induction expires in 7 days',
    );
    expect(reminderText('Sam', 0, '2026-11-21', 'supervisor').title).toBe(
      "Sam's site induction has expired",
    );
  });
});

describe('planInductionReminders', () => {
  const base: InductionReminderCandidate = {
    completionId: 'c1',
    inductionId: 'i1',
    projectId: 'p1',
    workerName: 'Sam',
    workerUserId: 'u-worker',
    ownerUserIds: ['u-site', 'u-worker'],
    expiresOn: '2026-12-01',
    threshold: 30,
  };
  it('tells the worker and the site team once each, keyed per person', () => {
    const plan = planInductionReminders([base]);
    expect(plan.map((p) => p.userId)).toEqual(['u-worker', 'u-site']);
    expect(new Set(plan.map((p) => p.dedupeKey)).size).toBe(2);
    expect(plan[0]!.dedupeKey).toBe('induction-expiry:c1:30:2026-12-01:u-worker');
  });
  it('re-arms with a new expiry date and uses an expired kind at 0', () => {
    const renewed = planInductionReminders([{ ...base, expiresOn: '2027-12-01' }]);
    expect(renewed[0]!.dedupeKey).not.toBe(planInductionReminders([base])[0]!.dedupeKey);
    expect(planInductionReminders([{ ...base, threshold: 0 }])[0]!.kind).toBe(
      'workforce.induction_expired',
    );
  });
  it('skips the worker when they have no login', () => {
    expect(planInductionReminders([{ ...base, workerUserId: null }]).map((p) => p.userId)).toEqual([
      'u-site',
      'u-worker',
    ]);
  });
});
