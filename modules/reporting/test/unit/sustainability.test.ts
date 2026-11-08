import { describe, expect, it } from 'vitest';
import {
  isCarbonRising,
  isDiversionFalling,
  isDiversionLow,
  orderFlags,
  projectFlags,
  sustainabilityAttention,
  sustainabilityTotals,
  type ProjectSustainability,
} from '../../src/domain/sustainability';

const base = (over: Partial<ProjectSustainability> = {}): ProjectSustainability => ({
  restricted: false,
  hasPlan: true,
  conditions: { nonCompliant: 0, overdue: 0, compliancePercent: 100 },
  documentsLapsing: 0,
  monitoring: { points: 2, openBreaches: 0, overdue: 0 },
  waste: {
    totalTonnes: 100,
    divertedTonnes: 90,
    landfillTonnes: 10,
    diversionPercent: 90,
    last30Tonnes: 20,
    last30DivertedTonnes: 18,
    last30DiversionPercent: 90,
    previous30Tonnes: 20,
    previous30DivertedTonnes: 18,
    previous30DiversionPercent: 90,
    regulatedWithoutDocket: 0,
  },
  carbon: { totalKg: 5000, last30Kg: 1000, previous30Kg: 1000, changePercent: 0 },
  ...over,
});
const waste = (w: Partial<ProjectSustainability['waste']>) => ({ ...base().waste, ...w });
const proj = { id: 'prj_1', name: 'Tower E' };

describe('diversion trend', () => {
  it('flags a drop of 10 points or more between the two 30-day windows', () => {
    expect(
      isDiversionFalling(
        base({ waste: waste({ last30DiversionPercent: 75, previous30DiversionPercent: 90 }) }),
      ),
    ).toBe(true);
    expect(
      isDiversionFalling(
        base({ waste: waste({ last30DiversionPercent: 82, previous30DiversionPercent: 90 }) }),
      ),
    ).toBe(false);
  });

  it('needs enough waste in both windows to say anything', () => {
    expect(
      isDiversionFalling(
        base({
          waste: waste({
            last30DiversionPercent: 10,
            previous30DiversionPercent: 90,
            last30Tonnes: 0.4,
          }),
        }),
      ),
    ).toBe(false);
    expect(
      isDiversionFalling(
        base({ waste: waste({ last30DiversionPercent: 10, previous30DiversionPercent: null }) }),
      ),
    ).toBe(false);
  });

  it('says low only under the target and once there is enough waste', () => {
    expect(isDiversionLow(base({ waste: waste({ diversionPercent: 70 }) }))).toBe(true);
    expect(isDiversionLow(base({ waste: waste({ diversionPercent: 80 }) }))).toBe(false);
    expect(isDiversionLow(base({ waste: waste({ diversionPercent: 10, totalTonnes: 0.5 }) }))).toBe(
      false,
    );
  });

  it('flags carbon up 25%+ only off a meaningful base', () => {
    expect(
      isCarbonRising(
        base({ carbon: { totalKg: 1, last30Kg: 2000, previous30Kg: 1000, changePercent: 100 } }),
      ),
    ).toBe(true);
    expect(
      isCarbonRising(
        base({ carbon: { totalKg: 1, last30Kg: 600, previous30Kg: 200, changePercent: 200 } }),
      ),
    ).toBe(false);
  });
});

describe('project flags and attention', () => {
  it('raises nothing for a healthy project and for a restricted one', () => {
    expect(projectFlags(proj, base())).toEqual([]);
    expect(
      projectFlags(
        proj,
        base({ restricted: true, monitoring: { points: 0, openBreaches: 4, overdue: 0 } }),
      ),
    ).toEqual([]);
    expect(
      sustainabilityAttention(
        base({ restricted: true, monitoring: { points: 0, openBreaches: 4, overdue: 0 } }),
      ),
    ).toBe(0);
  });

  it('prefers the falling-diversion flag over the low one, so one cause is not said twice', () => {
    const codes = projectFlags(
      proj,
      base({
        waste: waste({
          diversionPercent: 60,
          last30DiversionPercent: 50,
          previous30DiversionPercent: 70,
        }),
      }),
    ).map((f) => f.code);
    expect(codes).toContain('diversion_falling');
    expect(codes).not.toContain('diversion_low');
  });

  it('orders critical before warning, and weights breaches highest', () => {
    const flags = orderFlags([
      ...projectFlags(
        { id: 'b', name: 'Bravo' },
        base({ carbon: { totalKg: 1, last30Kg: 2000, previous30Kg: 1000, changePercent: 100 } }),
      ),
      ...projectFlags(
        { id: 'a', name: 'Alpha' },
        base({ monitoring: { points: 1, openBreaches: 2, overdue: 0 } }),
      ),
    ]);
    expect(flags.map((f) => f.code)).toEqual(['breach_open', 'carbon_rising']);
    expect(
      sustainabilityAttention(base({ monitoring: { points: 1, openBreaches: 2, overdue: 0 } })),
    ).toBe(6);
  });

  it('notes a project with no plan as info', () => {
    expect(projectFlags(proj, base({ hasPlan: false }))).toMatchObject([
      { code: 'plan_missing', severity: 'info' },
    ]);
  });
});

describe('company totals', () => {
  it('adds up readable projects only and works the rates from tonnes, not from averaged percentages', () => {
    const t = sustainabilityTotals([
      base({ waste: waste({ totalTonnes: 100, divertedTonnes: 90, landfillTonnes: 10 }) }),
      base({
        waste: waste({ totalTonnes: 300, divertedTonnes: 150, landfillTonnes: 150 }),
        monitoring: { points: 1, openBreaches: 2, overdue: 0 },
      }),
      base({ restricted: true, monitoring: { points: 0, openBreaches: 9, overdue: 0 } }),
    ]);
    expect(t).toMatchObject({
      projectsCovered: 2,
      projectsRestricted: 1,
      openBreaches: 2,
      wasteTonnes: 400,
      landfillTonnes: 160,
      diversionPercent: 60,
    });
  });

  it('has no diversion rate and no change without data', () => {
    const t = sustainabilityTotals([
      base({
        waste: waste({
          totalTonnes: 0,
          divertedTonnes: 0,
          landfillTonnes: 0,
          last30Tonnes: 0,
          last30DivertedTonnes: 0,
          previous30Tonnes: 0,
          previous30DivertedTonnes: 0,
        }),
        carbon: { totalKg: 0, last30Kg: 0, previous30Kg: 0, changePercent: null },
      }),
    ]);
    expect(t.diversionPercent).toBeNull();
    expect(t.last30DiversionPercent).toBeNull();
    expect(t.carbonChangePercent).toBeNull();
  });
});
