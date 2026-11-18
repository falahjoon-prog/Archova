import { describe, expect, it } from 'vitest';
import {
  itemProgress,
  plannedFraction,
  productionCurve,
  rateFlags,
  type Entry,
  type Item,
} from '../../src/domain/production';

const item = (over: Partial<Item> = {}): Item => ({
  id: 'a',
  name: 'Panels installed',
  uom: 'panels',
  trade: 'Solar',
  location: 'Block A',
  plannedQuantity: 100,
  plannedStart: '2026-10-05',
  plannedFinish: '2026-10-14',
  ...over,
});

describe('plannedFraction', () => {
  it('runs straight from start to finish inclusive', () => {
    const i = item();
    expect(plannedFraction(i, '2026-10-04')).toBe(0);
    expect(plannedFraction(i, '2026-10-05')).toBeCloseTo(0.1);
    expect(plannedFraction(i, '2026-10-09')).toBeCloseTo(0.5);
    expect(plannedFraction(i, '2026-10-14')).toBe(1);
    expect(plannedFraction(i, '2026-12-01')).toBe(1);
  });
});

describe('itemProgress', () => {
  it('is behind when installed trails the plan by more than the tolerance', () => {
    const p = itemProgress(item(), 30, '2026-10-09');
    expect(p).toMatchObject({
      plannedToDate: 50,
      variance: -20,
      pctComplete: 0.3,
      status: 'behind',
    });
  });
  it('is on track within tolerance, not started before the window, complete at the plan', () => {
    expect(itemProgress(item(), 47, '2026-10-09').status).toBe('on_track');
    expect(itemProgress(item(), 0, '2026-10-01').status).toBe('not_started');
    expect(itemProgress(item(), 100, '2026-10-09').status).toBe('complete');
  });
});

describe('productionCurve', () => {
  it('accumulates planned and actual by week and stops actual at today', () => {
    const entries: Entry[] = [
      { itemId: 'a', loggedOn: '2026-10-05', quantity: 10, crew: null },
      { itemId: 'a', loggedOn: '2026-10-12', quantity: 15, crew: null },
    ];
    const pts = productionCurve([item()], entries, '2026-10-09');
    expect(pts.map((p) => p.date)).toEqual(['2026-10-09', '2026-10-11', '2026-10-14']);
    expect(pts[0]).toMatchObject({ planned: 50, actual: 10 });
    expect(pts[1]).toMatchObject({ planned: 70, actual: null });
    expect(pts[2]).toMatchObject({ planned: 100, actual: null });
  });
  it('is empty without items', () => {
    expect(productionCurve([], [], '2026-10-09')).toEqual([]);
  });
});

describe('rateFlags', () => {
  const today = '2026-11-06'; // Friday; last 7 days = 2026-10-31..11-06
  const long = item({
    plannedStart: '2026-09-01',
    plannedFinish: '2026-12-31',
    plannedQuantity: 5000,
  });
  const weekdays = (from: string, n: number, qty: number, crew: string | null = null): Entry[] => {
    const out: Entry[] = [];
    const d = new Date(`${from}T00:00:00Z`);
    while (out.length < n) {
      if (d.getUTCDay() >= 1 && d.getUTCDay() <= 5)
        out.push({ itemId: 'a', loggedOn: d.toISOString().slice(0, 10), quantity: qty, crew });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return out;
  };

  it('flags a trade whose last week runs well under its trailing four-week average', () => {
    // baseline 2026-10-03..10-30: 20 weekdays at 10; recent: 5 weekdays at 5
    const entries = [...weekdays('2026-10-05', 20, 10), ...weekdays('2026-11-02', 5, 5)];
    const f = rateFlags([long], entries, today);
    expect(f).toEqual([
      {
        kind: 'trade',
        name: 'Solar',
        uom: 'panels',
        recentRate: 5,
        baselineRate: 10,
        dropPct: 0.5,
      },
    ]);
  });

  it('does not flag a small dip, a steady rate, or a thin baseline', () => {
    expect(
      rateFlags(
        [long],
        [...weekdays('2026-10-05', 20, 10), ...weekdays('2026-11-02', 5, 9)],
        today,
      ),
    ).toEqual([]);
    expect(
      rateFlags(
        [long],
        [...weekdays('2026-10-05', 20, 10), ...weekdays('2026-11-02', 5, 10)],
        today,
      ),
    ).toEqual([]);
    expect(
      rateFlags([long], [...weekdays('2026-10-26', 4, 10), ...weekdays('2026-11-02', 5, 1)], today),
    ).toEqual([]);
  });

  it('flags a crew separately from its trade and keeps units apart', () => {
    const entries = [
      ...weekdays('2026-10-05', 20, 10, 'Crew 2'),
      ...weekdays('2026-11-02', 5, 2, 'Crew 2'),
    ];
    const f = rateFlags([long, item({ id: 'b', uom: 'LF', trade: 'Solar' })], entries, today);
    expect(f.map((x) => `${x.kind}:${x.name}:${x.uom}`).sort()).toEqual([
      'crew:Crew 2:panels',
      'trade:Solar:panels',
    ]);
  });
});
