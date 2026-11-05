import { describe, expect, it } from 'vitest';
import { computeForecast } from '../../src/domain/forecast';

const sub = (id: string, o: Partial<Parameters<typeof computeForecast>[0][number]> = {}) => ({
  contractId: id,
  originalCents: 100_000_00,
  approvedVariationCents: 0,
  pendingVariationCents: 0,
  claimedCents: 0,
  ...o,
});
const head = {
  originalCents: 500_000_00,
  approvedVariationCents: 0,
  pendingVariationCents: 0,
  claimedCents: 0,
};

describe('computeForecast', () => {
  it('forecasts cost to complete as the unclaimed part of approved commitments', () => {
    const r = computeForecast(
      [sub('a', { approvedVariationCents: 10_000_00, claimedCents: 30_000_00 })],
      [head],
      [],
    );
    expect(r.committedCents).toBe(110_000_00);
    expect(r.costToCompleteCents).toBe(80_000_00);
    expect(r.forecastFinalCostCents).toBe(110_000_00);
    expect(r.forecastMarginCents).toBe(390_000_00);
    expect(r.forecastMarginPctHundredths).toBe(7800);
  });

  it('never lets an over-claim create a negative cost to complete', () => {
    const r = computeForecast([sub('a', { claimedCents: 120_000_00 })], [head], []);
    expect(r.costToCompleteCents).toBe(0);
    expect(r.forecastFinalCostCents).toBe(120_000_00);
  });

  it('adds adjustments to their contract or the project, and keeps pending variations out of the total', () => {
    const r = computeForecast(
      [sub('a', { pendingVariationCents: 5_000_00 })],
      [head],
      [
        { contractId: 'a', amountCents: 2_000_00 },
        { contractId: null, amountCents: 50_000_00 },
        { contractId: 'gone', amountCents: -1_000_00 },
      ],
    );
    expect(r.commitments[0]!.forecastFinalCents).toBe(102_000_00);
    expect(r.projectAdjustmentsCents).toBe(49_000_00);
    expect(r.forecastFinalCostCents).toBe(151_000_00);
    expect(r.pendingCostExposureCents).toBe(5_000_00);
  });

  it('reports a loss and no percentage when there is no revenue', () => {
    const loss = computeForecast([sub('a')], [{ ...head, originalCents: 80_000_00 }], []);
    expect(loss.forecastMarginCents).toBe(-20_000_00);
    expect(computeForecast([sub('a')], [], []).forecastMarginPctHundredths).toBeNull();
  });
});
