import { describe, expect, it } from 'vitest';
import { canSeePrivate, reopenFlag, statusCounts } from '../../src/domain/inspection-record';

const sec = (o: Partial<Parameters<typeof statusCounts>[0][number]>) => ({
  section: 'S',
  items: 0,
  answered: 0,
  pass: 0,
  fail: 0,
  na: 0,
  unanswered: 0,
  isNa: false,
  ...o,
});

describe('inspection record', () => {
  it('adds the section counts up for the donut', () => {
    expect(
      statusCounts([
        sec({ items: 4, pass: 2, fail: 1, unanswered: 1 }),
        sec({ items: 3, na: 1, answered: 1, unanswered: 1 }),
      ]),
    ).toEqual({ pass: 2, fail: 1, na: 1, answered: 1, unanswered: 2, total: 7 });
  });

  it('flags a second reopen, not the first', () => {
    expect(reopenFlag(0)).toBeNull();
    expect(reopenFlag(1)).toBeNull();
    expect(reopenFlag(2)).toMatchObject({ code: 'reopened_repeatedly', count: 2 });
  });

  it('shows a private inspection only to its people and to closers', () => {
    const i = { isPrivate: true, createdBy: 'a', inspectorId: 'b', assigneeIds: ['c'] };
    expect(canSeePrivate(i, 'a', false)).toBe(true);
    expect(canSeePrivate(i, 'b', false)).toBe(true);
    expect(canSeePrivate(i, 'c', false)).toBe(true);
    expect(canSeePrivate(i, 'z', false)).toBe(false);
    expect(canSeePrivate(i, 'z', true)).toBe(true);
    expect(canSeePrivate({ ...i, isPrivate: false }, 'z', false)).toBe(true);
  });
});
