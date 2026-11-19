import { describe, expect, it } from 'vitest';
import { computeFlags } from '../../src/domain/plant';
import { lastDayOfPreviousMonth, postableRange } from '../../src/domain/posting';

describe('which hire days to post', () => {
  it('finds the last day of last month, across a year end', () => {
    expect(lastDayOfPreviousMonth('2026-11-18')).toBe('2026-10-31');
    expect(lastDayOfPreviousMonth('2027-01-02')).toBe('2026-12-31');
    expect(lastDayOfPreviousMonth('2028-03-01')).toBe('2028-02-29');
  });

  it('posts a running allocation only up to the end of last month', () => {
    const a = { startsOn: '2026-10-20', endsOn: '2026-12-10', postedThrough: null };
    expect(postableRange(a, '2026-11-18')).toEqual({
      from: '2026-10-20',
      to: '2026-10-31',
      days: 12,
    });
    // The next run in the same month has nothing new.
    expect(postableRange({ ...a, postedThrough: '2026-10-31' }, '2026-11-25')).toBeNull();
    // In December the rest of November is due.
    expect(postableRange({ ...a, postedThrough: '2026-10-31' }, '2026-12-02')).toEqual({
      from: '2026-11-01',
      to: '2026-11-30',
      days: 30,
    });
  });

  it('posts the whole remainder once the allocation has ended, and the end day itself is not "today"', () => {
    const a = { startsOn: '2026-11-02', endsOn: '2026-11-06', postedThrough: null };
    expect(postableRange(a, '2026-11-06')).toBeNull();
    expect(postableRange(a, '2026-11-07')).toEqual({
      from: '2026-11-02',
      to: '2026-11-06',
      days: 5,
    });
    expect(postableRange({ ...a, postedThrough: '2026-11-06' }, '2026-11-20')).toBeNull();
  });

  it('posts nothing for an allocation that has not started or started this month and is still running', () => {
    expect(
      postableRange(
        { startsOn: '2026-12-01', endsOn: '2026-12-05', postedThrough: null },
        '2026-11-18',
      ),
    ).toBeNull();
    expect(
      postableRange(
        { startsOn: '2026-11-10', endsOn: '2026-11-30', postedThrough: null },
        '2026-11-18',
      ),
    ).toBeNull();
  });
});

describe('hire without a cost code', () => {
  const hired = {
    id: 'a1',
    name: 'Franna',
    assetNumber: 'CR-1',
    ownership: 'hired' as const,
    status: 'active' as const,
    dailyRateCents: 90000,
    createdOn: '2026-10-01',
  };
  const alloc = (costCodeId: string | null) => ({
    id: 'l1',
    assetId: 'a1',
    projectId: 'p1',
    startsOn: '2026-11-10',
    endsOn: '2026-11-20',
    costCodeId,
  });

  it('warns that the hire cost will not reach the budget', () => {
    const flags = computeFlags({
      assets: [hired],
      allocations: [alloc(null)],
      plans: [],
      today: '2026-11-18',
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      code: 'hire_not_costed',
      severity: 'warning',
      subjectId: 'l1',
    });
  });

  it('is quiet when the allocation has a cost code, or the machine is owned or unrated', () => {
    const today = '2026-11-18';
    expect(computeFlags({ assets: [hired], allocations: [alloc('c1')], plans: [], today })).toEqual(
      [],
    );
    expect(
      computeFlags({
        assets: [{ ...hired, ownership: 'owned' }],
        allocations: [alloc(null)],
        plans: [],
        today,
      }),
    ).toEqual([]);
    expect(
      computeFlags({
        assets: [{ ...hired, dailyRateCents: null }],
        allocations: [alloc(null)],
        plans: [],
        today,
      }),
    ).toEqual([]);
  });
});
