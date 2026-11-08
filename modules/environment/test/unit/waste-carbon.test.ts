import { describe, expect, it } from 'vitest';
import { DEFAULT_FACTORS, kgCo2e, SOURCE_SCOPE } from '../../src/domain/carbon';
import { environmentFlags } from '../../src/domain/flags';
import {
  diversionPercent,
  isDiverted,
  isDiversionFalling,
  percentChange,
} from '../../src/domain/waste';

const base = { today: '2026-11-08', plan: null, conditions: [], documents: [] };
const codes = (i: Parameters<typeof environmentFlags>[0]) => environmentFlags(i).map((f) => f.code);

describe('waste', () => {
  it('counts recycled and reused as diverted, landfill and treatment as not', () => {
    expect(isDiverted('recycled')).toBe(true);
    expect(isDiverted('reused')).toBe(true);
    expect(isDiverted('landfill')).toBe(false);
    expect(isDiverted('treatment')).toBe(false);
  });

  it('works out the diversion rate, and null with nothing recorded', () => {
    expect(diversionPercent(75, 100)).toBe(75);
    expect(diversionPercent(2, 3)).toBe(67);
    expect(diversionPercent(0, 0)).toBeNull();
  });

  it('works out a percentage change only against a base', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe('carbon', () => {
  it('multiplies the quantity by the factor', () => {
    expect(kgCo2e(1000, DEFAULT_FACTORS.diesel_litres)).toBe(2700);
    expect(kgCo2e(12.5, 320)).toBe(4000);
  });

  it('puts fuel in scope 1, electricity in scope 2 and materials in scope 3', () => {
    expect(SOURCE_SCOPE.diesel_litres).toBe(1);
    expect(SOURCE_SCOPE.electricity_kwh).toBe(2);
    expect(SOURCE_SCOPE.concrete_m3).toBe(3);
  });
});

describe('waste and carbon flags', () => {
  it('flags diversion under the target once there is enough waste to judge', () => {
    expect(
      codes({
        ...base,
        waste: { totalTonnes: 40, diversionPercent: 62, regulatedWithoutDocket: 0 },
      }),
    ).toContain('waste_diversion_low');
    expect(
      codes({
        ...base,
        waste: { totalTonnes: 40, diversionPercent: 85, regulatedWithoutDocket: 0 },
      }),
    ).not.toContain('waste_diversion_low');
    expect(
      codes({
        ...base,
        waste: { totalTonnes: 0.4, diversionPercent: 10, regulatedWithoutDocket: 0 },
      }),
    ).not.toContain('waste_diversion_low');
  });

  it('flags a hazardous or asbestos docket without a copy as critical', () => {
    const f = environmentFlags({
      ...base,
      waste: { totalTonnes: 5, diversionPercent: 90, regulatedWithoutDocket: 2 },
    }).find((x) => x.code === 'waste_docket_missing');
    expect(f?.severity).toBe('critical');
    expect(f?.message).toContain('2 hazardous or asbestos dockets');
  });

  it('flags emissions up 25% or more, but not off a tiny base', () => {
    expect(
      codes({ ...base, carbon: { last30Kg: 6000, previous30Kg: 4000, changePercent: 50 } }),
    ).toContain('carbon_rising');
    expect(
      codes({ ...base, carbon: { last30Kg: 4400, previous30Kg: 4000, changePercent: 10 } }),
    ).not.toContain('carbon_rising');
    expect(
      codes({ ...base, carbon: { last30Kg: 600, previous30Kg: 200, changePercent: 200 } }),
    ).not.toContain('carbon_rising');
  });
});

describe('falling diversion', () => {
  const w = (tonnes: number, diversionPercent: number | null) => ({ tonnes, diversionPercent });
  it('needs a drop of 10 points or more, with enough waste in both windows', () => {
    expect(isDiversionFalling(w(10, 70), w(10, 85))).toBe(true);
    expect(isDiversionFalling(w(10, 76), w(10, 85))).toBe(false);
    expect(isDiversionFalling(w(0.5, 10), w(10, 85))).toBe(false);
    expect(isDiversionFalling(w(10, 70), w(10, null))).toBe(false);
  });

  it('raises the project flag with both rates in the message', () => {
    const f = environmentFlags({
      ...base,
      waste: {
        totalTonnes: 40,
        diversionPercent: 85,
        regulatedWithoutDocket: 0,
        last30: w(10, 70),
        previous30: w(10, 90),
      },
    }).find((x) => x.code === 'waste_diversion_falling');
    expect(f?.message).toContain('fell from 90% to 70%');
  });
});
