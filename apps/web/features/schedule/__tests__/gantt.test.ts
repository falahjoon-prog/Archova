import { describe, expect, it } from 'vitest';
import { barBox, chartSpan, weekendBands, weekTicks } from '../lib/gantt';
import { groupByWeek } from '../lib/lookahead';
import { formatForFile } from '../lib/labels';

describe('gantt geometry', () => {
  const span = chartSpan(['2026-11-09', '2026-11-20'], '2026-11-05');
  it('pads to whole weeks that start on a Monday and include today', () => {
    expect(span.start).toBe('2026-10-26');
    expect(span.end).toBe('2026-11-29');
    expect(span.days).toBe(35);
  });
  it('places a bar from its first to its last day', () => {
    expect(barBox(span, '2026-11-09', '2026-11-11', 10)).toEqual({ left: 140, width: 30 });
    expect(barBox(span, '2026-11-09', '2026-11-09', 10)).toEqual({ left: 140, width: 10 });
  });
  it('ticks every Monday and thins out when weeks are narrow', () => {
    expect(weekTicks(span, 28).map((t) => t.label)).toEqual([
      '26 Oct',
      '2 Nov',
      '9 Nov',
      '16 Nov',
      '23 Nov',
    ]);
    expect(weekTicks(span, 4).map((t) => t.date)).toEqual([
      '2026-10-26',
      '2026-11-09',
      '2026-11-23',
    ]);
  });
  it('shades the weekends', () => {
    expect(weekendBands(span, 10)[0]).toEqual({ left: 50, width: 20 });
    expect(weekendBands(span, 10)).toHaveLength(5);
  });
  it('always shows at least four weeks, even for an empty programme', () => {
    expect(chartSpan([], '2026-11-05').days).toBeGreaterThanOrEqual(28);
  });
});

describe('look-ahead weeks', () => {
  const item = (id: string, start: string, finish: string) => ({
    activity: { id, start, finish },
    startsInWindow: true,
  });
  it('lists an activity under every week it runs and marks the week it starts', () => {
    const g = groupByWeek(
      [item('a', '2026-11-04', '2026-11-12'), item('b', '2026-11-16', '2026-11-16')],
      '2026-11-02',
      3,
    );
    expect(g.map((w) => w.items.map((i) => i.activity.id))).toEqual([['a'], ['a'], ['b']]);
    expect([...g[0]!.starting]).toEqual(['a']);
    expect([...g[1]!.starting]).toEqual([]);
  });
});

describe('import file type', () => {
  it('reads the format from the extension', () => {
    expect(formatForFile('Tower.XER')).toBe('p6');
    expect(formatForFile('tower.xml')).toBe('msp');
    expect(formatForFile('tower.mpp')).toBeNull();
  });
});
