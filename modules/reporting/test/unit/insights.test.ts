import { describe, expect, it } from 'vitest';
import { buildInsights, dollars } from '../../src/domain/insights';

const counts = (
  over: Record<string, Partial<{ open: number; overdue: number; restricted: boolean }>> = {},
) => {
  const base = { restricted: false, open: 0, overdue: 0, dueSoon: 0 };
  const pick = (k: string) => ({ ...base, ...(over[k] ?? {}) });
  return {
    rfis: pick('rfis'),
    defects: pick('defects'),
    submittals: pick('submittals'),
    claims: pick('claims'),
    variations: pick('variations'),
    incidents: {
      ...pick('incidents'),
      lastInjuryOn: null,
      lastIncidentOn: null,
      daysSinceInjury: null,
      daysSinceIncident: null,
      last12Months: 0,
    },
    observations: pick('observations'),
    inspections: pick('inspections'),
    programme: { ...pick('programme'), notStarted: 0, completed: 0, lateDays: 0 },
  };
};
const budget = (over = {}) => ({
  restricted: false,
  hasBudget: true,
  revisedCents: 420_000_000,
  spentCents: 0,
  monthly: [],
  forecastFinalCents: 420_000_000,
  varianceCents: 0,
  overBudgetCodes: 0,
  ...over,
});
const slip = (over = {}) => ({
  restricted: false,
  hasProgramme: true,
  lateCount: 0,
  worst: [],
  ...over,
});

describe('dollars', () => {
  it('rounds to whole dollars with separators', () => {
    expect(dollars(18_240_000)).toBe('$182,400');
    expect(dollars(-99)).toBe('-$1');
    expect(dollars(0)).toBe('$0');
  });
});

describe('buildInsights', () => {
  it('returns nothing for a healthy project', () => {
    expect(buildInsights({ counts: counts(), budget: budget(), slip: slip() })).toEqual([]);
  });

  it('flags a forecast over budget and ranks it above lesser notes', () => {
    const out = buildInsights({
      counts: counts({ rfis: { open: 9, overdue: 1 } }),
      budget: budget({
        forecastFinalCents: 438_240_000,
        varianceCents: -18_240_000,
        overBudgetCodes: 3,
      }),
      slip: slip(),
    });
    expect(out.map((i) => i.id)).toEqual(['budget', 'rfis']);
    expect(out[0]).toMatchObject({ severity: 'medium', title: 'Forecast is $182,400 over budget' });
    expect(out[0]!.facts).toContain('Forecast over budget by: $182,400');
    expect(out[1]).toMatchObject({ severity: 'low' });
  });

  it('rates an overrun of 5% or more as high', () => {
    const out = buildInsights({
      counts: counts(),
      budget: budget({ varianceCents: -21_000_000, overBudgetCodes: 1 }),
      slip: slip(),
    });
    expect(out[0]!.severity).toBe('high');
  });

  it('treats a small overrun as medium and codes-only overrun as low', () => {
    const small = buildInsights({
      counts: counts(),
      budget: budget({ varianceCents: -1_000_000, overBudgetCodes: 1 }),
      slip: slip(),
    });
    expect(small[0]!.severity).toBe('medium');
    const codesOnly = buildInsights({
      counts: counts(),
      budget: budget({ overBudgetCodes: 2 }),
      slip: slip(),
    });
    expect(codesOnly[0]).toMatchObject({
      severity: 'low',
      title: '2 cost codes forecast over budget',
    });
  });

  it('reports programme slip with the furthest-behind task', () => {
    const out = buildInsights({
      counts: counts(),
      budget: budget(),
      slip: slip({ lateCount: 4, worst: [{ wbs: '3.2', name: 'Level 4 slab', daysLate: 16 }] }),
    });
    expect(out[0]).toMatchObject({ id: 'programme', severity: 'high' });
    expect(out[0]!.facts).toContain('3.2 Level 4 slab is 16 days late');
  });

  it('says nothing about a tool the caller cannot read', () => {
    const out = buildInsights({
      counts: counts({ rfis: { restricted: true, open: 9, overdue: 9 } }),
      budget: budget({ restricted: true, varianceCents: -5, overBudgetCodes: 9 }),
      slip: slip({ restricted: true, lateCount: 9 }),
    });
    expect(out).toEqual([]);
  });

  it('orders equal severities in a fixed kind order', () => {
    const out = buildInsights({
      counts: counts({ defects: { open: 3, overdue: 1 }, rfis: { open: 3, overdue: 1 } }),
      budget: budget(),
      slip: slip(),
    });
    expect(out.map((i) => i.id)).toEqual(['rfis', 'defects']);
  });
});
