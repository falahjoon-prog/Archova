import { describe, expect, it } from 'vitest';
import { budgetVsForecast } from '../../src/domain/budget-vs-forecast';

const lines = [
  { costCodeId: 'c1', code: '03', description: 'Concrete', revisedCents: 100_000 },
  { costCodeId: 'c2', code: '09', description: 'Paint', revisedCents: 20_000 },
];

describe('budget vs forecast', () => {
  it('compares each code, sending untagged cost to unallocated', () => {
    const r = budgetVsForecast(
      lines,
      [
        {
          committedCents: 90_000,
          claimedCents: 40_000,
          items: [
            { costCodeId: 'c1', valueCents: 60_000, claimedCents: 30_000 },
            { costCodeId: null, valueCents: 20_000, claimedCents: 5_000 },
          ],
        },
      ],
      [
        { costCodeId: 'c1', amountCents: 5_000 },
        { costCodeId: null, amountCents: -1_000 },
      ],
    );
    const c1 = r.rows.find((x) => x.costCodeId === 'c1')!;
    expect(c1).toMatchObject({
      committedCents: 60_000,
      claimedCents: 30_000,
      adjustmentsCents: 5_000,
    });
    expect(c1.forecastFinalCents).toBe(30_000 + 30_000 + 5_000);
    expect(c1.varianceCents).toBe(100_000 - 65_000);
    // 90k committed - 60k coded = 30k unallocated; 40k - 30k = 10k claimed; 20k to complete; -1k adjustment.
    expect(r.unallocated).toMatchObject({
      committedCents: 30_000,
      claimedCents: 10_000,
      forecastFinalCents: 29_000,
    });
    expect(r.totals.forecastFinalCents).toBe(65_000 + 0 + 29_000);
    expect(r.totals.revisedCents).toBe(120_000);
  });

  it('shows spend on a code with no budget line as over budget', () => {
    const r = budgetVsForecast(
      [],
      [
        {
          committedCents: 10_000,
          claimedCents: 0,
          items: [{ costCodeId: 'x', valueCents: 10_000, claimedCents: 0 }],
        },
      ],
      [],
    );
    expect(r.rows[0]).toMatchObject({ costCodeId: 'x', revisedCents: 0, varianceCents: -10_000 });
  });

  it('never goes negative on an over-claim and leaves hidden codes out of every total', () => {
    const r = budgetVsForecast(
      lines,
      [
        {
          committedCents: 10_000,
          claimedCents: 12_000,
          items: [{ costCodeId: 'c2', valueCents: 10_000, claimedCents: 12_000 }],
        },
      ],
      [{ costCodeId: 'c2', amountCents: 700 }],
      new Set(['c2']),
    );
    expect(r.totals.forecastFinalCents).toBe(0);
    expect(r.unallocated.committedCents).toBe(0);
  });

  it('counts direct costs as spent, with nothing left to complete, and honours hidden codes', () => {
    const direct = [
      { costCodeId: 'c1', amountCents: 7_000 },
      { costCodeId: 'c2', amountCents: 1_500 },
      { costCodeId: null, amountCents: 500 },
    ];
    const r = budgetVsForecast(lines, [], [], new Set(), direct);
    const c1 = r.rows.find((x) => x.costCodeId === 'c1')!;
    expect(c1).toMatchObject({ directCents: 7_000, forecastFinalCents: 7_000 });
    expect(c1.varianceCents).toBe(100_000 - 7_000);
    expect(r.unallocated).toMatchObject({ directCents: 500, forecastFinalCents: 500 });
    expect(r.totals).toMatchObject({ directCents: 9_000, forecastFinalCents: 9_000 });

    const hidden = budgetVsForecast(lines, [], [], new Set(['c2']), direct);
    expect(hidden.totals.directCents).toBe(7_500);
  });
});
