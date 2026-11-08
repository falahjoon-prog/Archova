import { describe, expect, it } from 'vitest';
import { environmentFlags } from '../../src/domain/flags';
import { isPointOverdue, isTrendingToBreach, judgeReading } from '../../src/domain/monitoring';

describe('judgeReading', () => {
  const dust = { min: null, max: 50, warnMargin: 0.2 };
  it('is ok well inside the limit, a warning close to it, a breach over it', () => {
    expect(judgeReading(30, dust)).toBe('ok');
    expect(judgeReading(40, dust)).toBe('warning');
    expect(judgeReading(50, dust)).toBe('warning');
    expect(judgeReading(50.1, dust)).toBe('breach');
  });

  it('judges both ends of a range such as pH', () => {
    const ph = { min: 6.5, max: 8.5, warnMargin: 0.1 };
    expect(judgeReading(7.5, ph)).toBe('ok');
    expect(judgeReading(6.5, ph)).toBe('warning');
    expect(judgeReading(6.4, ph)).toBe('breach');
    expect(judgeReading(8.6, ph)).toBe('breach');
    expect(judgeReading(8, ph)).toBe('ok');
    expect(judgeReading(8.2, ph)).toBe('ok');
    expect(judgeReading(8.3, ph)).toBe('warning');
  });

  it('has no warning band with a zero margin', () => {
    expect(judgeReading(50, { min: null, max: 50, warnMargin: 0 })).toBe('warning');
    expect(judgeReading(40, { min: null, max: 50, warnMargin: 0 })).toBe('ok');
  });
});

describe('overdue and trending', () => {
  it('is overdue after the interval plus a day, measured from the last reading or creation', () => {
    expect(isPointOverdue('daily', '2026-11-05', '2026-10-01', '2026-11-07')).toBe(false);
    expect(isPointOverdue('daily', '2026-11-04', '2026-10-01', '2026-11-07')).toBe(true);
    expect(isPointOverdue('weekly', null, '2026-10-01', '2026-11-07')).toBe(true);
    expect(isPointOverdue('per_event', null, '2026-10-01', '2026-11-07')).toBe(false);
  });

  it('flags three rising readings that end close to the maximum', () => {
    const l = { min: null, max: 50, warnMargin: 0.2 };
    expect(isTrendingToBreach([30, 36, 44], l)).toBe(true);
    expect(isTrendingToBreach([30, 36, 38], l)).toBe(false);
    expect(isTrendingToBreach([44, 36, 42], l)).toBe(false);
    expect(isTrendingToBreach([44, 46], l)).toBe(false);
  });
});

describe('monitoring flags', () => {
  const base = {
    today: '2026-11-07',
    plan: { status: 'active' as const, nextReviewDate: '2027-05-07' },
    conditions: [],
    documents: [],
  };
  it('raises breach, overdue and trending flags', () => {
    const flags = environmentFlags({
      ...base,
      monitoring: {
        openBreaches: 2,
        breaching: [{ name: 'North boundary dust' }],
        overdue: [{ name: 'Noise logger' }],
        trending: [{ name: 'Basin turbidity' }],
      },
    });
    expect(flags.map((f) => [f.code, f.severity])).toEqual([
      ['monitoring_breach_open', 'critical'],
      ['monitoring_overdue', 'warning'],
      ['monitoring_trending', 'warning'],
    ]);
    expect(flags[0]!.message).toContain('2 monitoring breaches');
    expect(flags[0]!.message).toContain('North boundary dust');
  });
  it('is quiet with no monitoring problems', () => {
    expect(
      environmentFlags({
        ...base,
        monitoring: { openBreaches: 0, breaching: [], overdue: [], trending: [] },
      }),
    ).toEqual([]);
  });
});
