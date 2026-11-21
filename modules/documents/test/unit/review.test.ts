import { describe, expect, it } from 'vitest';
import {
  initialStatuses,
  overdueDays,
  settle,
  suggestReviewers,
  type StepState,
} from '../../src/domain/review';

const step = (
  id: string,
  order: number,
  status: StepState['status'],
  role: StepState['role'] = 'reviewer',
): StepState => ({
  id,
  userId: `u-${id}`,
  role,
  order,
  status,
});

describe('initialStatuses', () => {
  it('starts everyone in a parallel round', () => {
    expect(initialStatuses('parallel', [{ order: 1 }, { order: 2 }])).toEqual([
      'pending',
      'pending',
    ]);
  });
  it('starts only the first order group in a sequential round', () => {
    expect(initialStatuses('sequential', [{ order: 2 }, { order: 1 }, { order: 1 }])).toEqual([
      'waiting',
      'pending',
      'pending',
    ]);
  });
});

describe('settle', () => {
  it('waits for the whole order group before moving on', () => {
    const r = settle('sequential', [
      step('a', 1, 'approved'),
      step('b', 1, 'pending'),
      step('c', 2, 'waiting'),
    ]);
    expect(r.outcome).toBe('open');
    expect(r.statuses.get('c')).toBe('waiting');
  });
  it('activates the next group when the current one is decided', () => {
    const r = settle('sequential', [
      step('a', 1, 'approved'),
      step('b', 2, 'waiting'),
      step('c', 2, 'waiting'),
      step('d', 3, 'waiting'),
    ]);
    expect(r.outcome).toBe('open');
    expect(r.statuses.get('b')).toBe('pending');
    expect(r.statuses.get('c')).toBe('pending');
    expect(r.statuses.get('d')).toBe('waiting');
  });
  it('approves when every step is decided, including approved with comments', () => {
    const r = settle('parallel', [
      step('a', 1, 'approved'),
      step('b', 1, 'approved_with_comments', 'approver'),
    ]);
    expect(r.outcome).toBe('approved');
  });
  it('rejects at once and skips what is still open', () => {
    const r = settle('sequential', [
      step('a', 1, 'rejected'),
      step('b', 2, 'waiting'),
      step('c', 1, 'pending'),
    ]);
    expect(r.outcome).toBe('rejected');
    expect(r.statuses.get('b')).toBe('skipped');
    expect(r.statuses.get('c')).toBe('skipped');
    expect(r.statuses.get('a')).toBe('rejected');
  });
  it('keeps a parallel round open until the last person decides', () => {
    expect(settle('parallel', [step('a', 1, 'approved'), step('b', 1, 'pending')]).outcome).toBe(
      'open',
    );
  });
});

describe('overdueDays', () => {
  const now = new Date('2026-11-21T00:00:00Z');
  it('is zero before the due date', () => {
    expect(overdueDays({ dueAt: new Date('2026-11-22T00:00:00Z'), waitingSince: null, now })).toBe(
      0,
    );
  });
  it('counts whole days past the due date, at least one', () => {
    expect(overdueDays({ dueAt: new Date('2026-11-18T00:00:00Z'), waitingSince: null, now })).toBe(
      3,
    );
    expect(overdueDays({ dueAt: new Date('2026-11-20T20:00:00Z'), waitingSince: null, now })).toBe(
      1,
    );
  });
  it('falls back to a 5 day SLA from when the person was handed the step', () => {
    expect(overdueDays({ dueAt: null, waitingSince: new Date('2026-11-17T00:00:00Z'), now })).toBe(
      0,
    );
    expect(overdueDays({ dueAt: null, waitingSince: new Date('2026-11-10T00:00:00Z'), now })).toBe(
      6,
    );
  });
  it('is zero with no date and nobody waiting', () => {
    expect(overdueDays({ dueAt: null, waitingSince: null, now })).toBe(0);
  });
});

describe('suggestReviewers', () => {
  it('ranks by how often a person decided, and picks the role they hold most', () => {
    const out = suggestReviewers([
      { userId: 'b', role: 'reviewer' },
      { userId: 'a', role: 'approver' },
      { userId: 'a', role: 'approver' },
      { userId: 'a', role: 'reviewer' },
      { userId: 'c', role: 'reviewer' },
    ]);
    expect(out.map((o) => [o.userId, o.role, o.count])).toEqual([
      ['a', 'approver', 3],
      ['b', 'reviewer', 1],
      ['c', 'reviewer', 1],
    ]);
  });
  it('respects the limit', () => {
    expect(
      suggestReviewers(
        [
          { userId: 'a', role: 'reviewer' },
          { userId: 'b', role: 'reviewer' },
        ],
        1,
      ),
    ).toHaveLength(1);
  });
});
