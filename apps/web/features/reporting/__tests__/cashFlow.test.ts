import { describe, expect, it } from 'vitest';
import { cashFlow } from '../lib/cashFlow';
import type { PortfolioProject } from '../lib/types';

const proj = (
  monthly: { month: string; spent: string }[],
  over: Partial<PortfolioProject['budget']> = {},
) =>
  ({
    budget: {
      restricted: false,
      hasBudget: true,
      revised: '0',
      forecastFinal: '0',
      spent: '0',
      variance: '0',
      overBudgetCodes: 0,
      monthly,
      ...over,
    },
  }) as unknown as PortfolioProject;

describe('cashFlow', () => {
  it('is empty with no spend', () => {
    expect(cashFlow([proj([])])).toEqual([]);
  });

  it('adds projects together, fills quiet months and keeps a running total', () => {
    const r = cashFlow([
      proj([{ month: '2026-09', spent: '100.00' }]),
      proj([
        { month: '2026-09', spent: '50.50' },
        { month: '2026-11', spent: '20.00' },
      ]),
    ]);
    expect(r.map((m) => [m.label, m.spent, m.cumulative])).toEqual([
      ['Sep 2026', '150.50', '150.50'],
      ['Oct 2026', '0.00', '150.50'],
      ['Nov 2026', '20.00', '170.50'],
    ]);
  });

  it('ignores restricted projects and keeps the running total when cutting to the latest months', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      month: `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`,
      spent: '10.00',
    }));
    const r = cashFlow([
      proj(many),
      proj([{ month: '2026-01', spent: '999.00' }], { restricted: true }),
    ]);
    expect(r).toHaveLength(12);
    expect(r[0]?.label).toBe('Mar 2026');
    expect(r[11]?.cumulative).toBe('140.00');
  });
});
