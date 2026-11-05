import { describe, expect, it } from 'vitest';
import { capitalTotals } from '../../src/domain/capital';

describe('capitalTotals', () => {
  it('totals each fiscal year in order, then all years last', () => {
    const t = capitalTotals([
      { fiscalYear: 2028, budgetCents: 100, forecastCents: 110, spentCents: 0 },
      { fiscalYear: 2027, budgetCents: 500, forecastCents: 450, spentCents: 200 },
      { fiscalYear: 2027, budgetCents: 50, forecastCents: 60, spentCents: 10 },
    ]);
    expect(t).toEqual([
      { fiscalYear: 2027, budgetCents: 550, forecastCents: 510, spentCents: 210 },
      { fiscalYear: 2028, budgetCents: 100, forecastCents: 110, spentCents: 0 },
      { fiscalYear: null, budgetCents: 650, forecastCents: 620, spentCents: 210 },
    ]);
  });

  it('gives a zero all-years total for an empty plan', () => {
    expect(capitalTotals([])).toEqual([
      { fiscalYear: null, budgetCents: 0, forecastCents: 0, spentCents: 0 },
    ]);
  });
});
