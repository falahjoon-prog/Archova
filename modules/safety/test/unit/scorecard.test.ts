import { describe, expect, it } from 'vitest';
import {
  buildScorecard,
  ratingFor,
  riskFlag,
  type ScorecardInputs,
} from '../../src/domain/scorecard';

const now = new Date('2026-11-21T00:00:00Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * 86_400_000);
const empty: ScorecardInputs = {
  incidents: [],
  actions: { total: 0, overdueOpen: 0 },
  swms: { total: 0, rejected: 0, expired: 0 },
  inductions: { signed: 0, notCurrent: 0 },
  findings: { raised: 0, overdueOpen: 0 },
};
const inc = (days: number, severity: 'low' | 'medium' | 'high' | 'critical', extra = {}) => ({
  occurredAt: daysAgo(days),
  severity,
  isNotifiable: false,
  injured: false,
  projectId: 'p1',
  ...extra,
});

describe('safety scorecard', () => {
  it('scores a company with no history 100 and flags nothing', () => {
    const c = buildScorecard(empty, now);
    expect(c.score).toBe(100);
    expect(c.rating).toBe('good');
    expect(c.flags).toEqual([]);
    expect(riskFlag('Acme', c)).toBeNull();
  });

  it('bands the rating', () => {
    expect([ratingFor(90), ratingFor(75), ratingFor(55), ratingFor(10)]).toEqual([
      'good',
      'watch',
      'elevated',
      'high',
    ]);
  });

  it('counts a recent serious injury more than an old one and flags it', () => {
    const recent = buildScorecard(
      { ...empty, incidents: [inc(10, 'high', { injured: true, isNotifiable: true })] },
      now,
    );
    const old = buildScorecard(
      { ...empty, incidents: [inc(300, 'high', { injured: true, isNotifiable: true })] },
      now,
    );
    expect(recent.score).toBeLessThan(old.score);
    expect(recent.flags.join(' ')).toMatch(/high-severity incident in the last 90 days/);
    expect(recent.trend).toBe('worsening');
    expect(riskFlag('Acme', recent)).toMatch(/^Acme: /);
  });

  it('ignores incidents older than 12 months and shows an improving trend', () => {
    const c = buildScorecard(
      { ...empty, incidents: [inc(400, 'critical'), inc(120, 'high')] },
      now,
    );
    expect(c.counts.incidents12m).toBe(1);
    expect(c.trend).toBe('improving');
  });

  it('caps each component and never goes below zero', () => {
    const c = buildScorecard(
      {
        incidents: Array.from({ length: 20 }, () => inc(5, 'critical', { isNotifiable: true })),
        actions: { total: 30, overdueOpen: 30 },
        swms: { total: 9, rejected: 5, expired: 4 },
        inductions: { signed: 10, notCurrent: 10 },
        findings: { raised: 50, overdueOpen: 40 },
      },
      now,
    );
    expect(c.score).toBe(0);
    expect(c.components.every((x) => x.lost <= x.max)).toBe(true);
  });

  it('only judges induction compliance from three sign-ons', () => {
    const few = buildScorecard({ ...empty, inductions: { signed: 2, notCurrent: 2 } }, now);
    expect(few.score).toBe(100);
    const many = buildScorecard({ ...empty, inductions: { signed: 5, notCurrent: 5 } }, now);
    expect(many.score).toBe(85);
  });
});
