import { describe, expect, it } from 'vitest';
import { monthlySpend } from '../../src/domain/monthly-spend';

describe('monthlySpend', () => {
  it('is empty with no spend', () => {
    expect(monthlySpend([])).toEqual([]);
  });

  it('sums by month, oldest first, and fills the quiet months with zero', () => {
    const r = monthlySpend([
      { month: '2026-11', costCodeId: 'a', cents: 500 },
      { month: '2026-09', costCodeId: 'a', cents: 100 },
      { month: '2026-09', costCodeId: null, cents: 50 },
    ]);
    expect(r).toEqual([
      { month: '2026-09', spentCents: 150 },
      { month: '2026-10', spentCents: 0 },
      { month: '2026-11', spentCents: 500 },
    ]);
  });

  it('crosses a year end', () => {
    const r = monthlySpend([
      { month: '2026-12', costCodeId: null, cents: 1 },
      { month: '2027-01', costCodeId: null, cents: 2 },
    ]);
    expect(r.map((x) => x.month)).toEqual(['2026-12', '2027-01']);
  });

  it('leaves hidden margin codes out, so a month with only hidden spend does not appear', () => {
    const r = monthlySpend(
      [
        { month: '2026-09', costCodeId: 'm', cents: 999 },
        { month: '2026-10', costCodeId: 'a', cents: 10 },
      ],
      new Set(['m']),
    );
    expect(r).toEqual([{ month: '2026-10', spentCents: 10 }]);
  });
});
