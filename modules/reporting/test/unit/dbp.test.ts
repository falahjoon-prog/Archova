import { describe, expect, it } from 'vitest';
import { buildInsights, lastMonths, passRate } from '../../src/domain/dbp';

const insp = (over = {}) => ({
  tradeCategory: 'fire_safety' as const,
  late: false,
  completedOn: '2026-10-12',
  pass: 0,
  fail: 0,
  ...over,
});
const obs = (over = {}) => ({
  tradeCategory: 'fire_safety' as const,
  classification: 'serious_defect' as const,
  contributingCondition: 'workmanship' as const,
  late: false,
  ...over,
});
const proj = (over = {}) => ({
  id: 'prj_a',
  name: 'A',
  restricted: false,
  inspections: [],
  observations: [],
  ...over,
});

describe('passRate', () => {
  it('is a whole percent of answered items, null when none were answered', () => {
    expect(passRate(0, 0)).toBeNull();
    expect(passRate(2, 1)).toBe(67);
    expect(passRate(5, 0)).toBe(100);
  });
});

describe('lastMonths', () => {
  it('counts back across a year boundary, oldest first', () => {
    expect(lastMonths('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
});

describe('buildInsights', () => {
  const today = '2026-11-06';

  it('rolls pass rate, late counts and classifications up by building element', () => {
    const r = buildInsights(
      [
        proj({
          inspections: [insp({ pass: 8, fail: 2 }), insp({ late: true, completedOn: null })],
          observations: [
            obs(),
            obs({ classification: 'low_risk', late: true }),
            obs({ tradeCategory: null, classification: null, contributingCondition: null }),
          ],
        }),
      ],
      today,
    );
    const fire = r.categories.find((c) => c.category === 'fire_safety')!;
    expect(fire.itemsPassing).toEqual({ pass: 8, fail: 2, rate: 80 });
    expect(fire.lateInspections).toBe(1);
    expect(fire.lateObservations).toBe(1);
    expect(fire.classifications.serious_defect).toBe(1);
    expect(
      r.categories.find((c) => c.category === 'uncategorised')!.classifications.unclassified,
    ).toBe(1);
    expect(r.classificationTotals).toEqual({
      serious_defect: 1,
      potential_serious_defect: 0,
      low_risk: 1,
      unclassified: 1,
    });
    expect(r.conditions).toContainEqual({ condition: 'not_recorded', count: 1 });
  });

  it('hides the uncategorised card when nothing falls in it, and shows a null rate with no answers', () => {
    const r = buildInsights([proj({ inspections: [insp()] })], today);
    expect(r.categories.some((c) => c.category === 'uncategorised')).toBe(false);
    expect(r.categories.find((c) => c.category === 'fire_safety')!.itemsPassing.rate).toBeNull();
  });

  it('puts completed inspections in their month and ignores ones older than 12 months', () => {
    const r = buildInsights(
      [
        proj({
          inspections: [
            insp({ pass: 3, fail: 1, completedOn: '2026-10-02' }),
            insp({ pass: 9, fail: 0, completedOn: '2024-01-02' }),
          ],
        }),
      ],
      today,
    );
    expect(r.passRateTrend).toHaveLength(12);
    expect(r.passRateTrend.at(-2)).toEqual({ month: '2026-10', pass: 3, fail: 1, rate: 75 });
    expect(r.passRateTrend.every((m) => m.month >= '2025-12')).toBe(true);
  });

  it('orders projects by serious defects, then late items', () => {
    const r = buildInsights(
      [
        proj({ id: 'a', name: 'Alpha', observations: [obs({ classification: 'low_risk' })] }),
        proj({ id: 'b', name: 'Beta', observations: [obs()] }),
      ],
      today,
    );
    expect(r.projects.map((p) => p.name)).toEqual(['Beta', 'Alpha']);
  });
});
