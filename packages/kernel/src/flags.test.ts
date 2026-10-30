import { describe, expect, it } from 'vitest';
import { evaluateFlag, flagBucket, type FlagRules } from './flags';

const rules = (over: Partial<FlagRules> = {}): FlagRules => ({
  key: 'nova_estimating',
  enabledForAll: false,
  percent: 0,
  orgIds: new Set(),
  cohortIds: new Set(),
  ...over,
});
const org = { id: '0192f7c0-0000-7000-8000-000000000001', cohortIds: ['c1'] };

describe('evaluateFlag', () => {
  it('is off with no rules and for an unknown flag', () => {
    expect(evaluateFlag(undefined, org)).toBe(false);
    expect(evaluateFlag(rules(), org)).toBe(false);
  });

  it('turns on for all, a listed org or a cohort the org is in', () => {
    expect(evaluateFlag(rules({ enabledForAll: true }), org)).toBe(true);
    expect(evaluateFlag(rules({ orgIds: new Set([org.id]) }), org)).toBe(true);
    expect(evaluateFlag(rules({ cohortIds: new Set(['c1']) }), org)).toBe(true);
    expect(evaluateFlag(rules({ cohortIds: new Set(['c2']) }), org)).toBe(false);
  });

  it('rolls out a stable share by percentage', () => {
    expect(flagBucket('k', org.id)).toBe(flagBucket('k', org.id));
    const ids = Array.from({ length: 2000 }, (_, i) => `org-${i}`);
    const on = ids.filter((id) => evaluateFlag(rules({ percent: 25 }), { id, cohortIds: [] }));
    expect(on.length).toBeGreaterThan(400);
    expect(on.length).toBeLessThan(600);
    expect(ids.every((id) => evaluateFlag(rules({ percent: 100 }), { id, cohortIds: [] }))).toBe(
      true,
    );
  });
});
