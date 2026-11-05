import { describe, expect, it } from 'vitest';
import {
  barBox,
  chartSpan,
  dragDays,
  draggedDates,
  varianceLabel,
  weekendBands,
  weekTicks,
} from '../lib/gantt';
import { groupByWeek } from '../lib/lookahead';
import { formatForFile } from '../lib/labels';
import { openItemsByActivity, openItemsLabel } from '../lib/links';
import type { ScheduleLink } from '../data/programme';

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

describe('open linked items on the programme', () => {
  const link = (over: Partial<ScheduleLink>): ScheduleLink => ({
    id: 'slk_1',
    activityId: 'a1',
    kind: 'rfi',
    targetId: 'rfi_1',
    visible: true,
    ref: 'RFI-001',
    title: 'x',
    status: 'open',
    dueDate: null,
    scheduleImpactDays: null,
    ...over,
  });
  const starts = new Map([['a1', '2026-11-09']]);

  it('counts open RFIs and unfinished submittals, and skips answered, approved and hidden items', () => {
    const out = openItemsByActivity(
      [
        link({}),
        link({ id: 'l2', status: 'answered' }),
        link({ id: 'l3', kind: 'submittal', status: 'in_review' }),
        link({ id: 'l4', kind: 'submittal', status: 'approved' }),
        link({ id: 'l5', visible: false, status: null }),
      ],
      starts,
      '2026-11-05',
    );
    expect(out.get('a1')).toEqual({ rfis: 1, submittals: 1, atRisk: false });
    expect(openItemsLabel(out.get('a1')!)).toBe('1 open RFI, 1 open submittal');
  });

  it('flags an overdue item or one due on or after the start', () => {
    expect(
      openItemsByActivity([link({ dueDate: '2026-11-03' })], starts, '2026-11-05').get('a1')
        ?.atRisk,
    ).toBe(true);
    expect(
      openItemsByActivity([link({ dueDate: '2026-11-09' })], starts, '2026-11-05').get('a1')
        ?.atRisk,
    ).toBe(true);
    expect(
      openItemsByActivity([link({ dueDate: '2026-11-06' })], starts, '2026-11-05').get('a1')
        ?.atRisk,
    ).toBe(false);
  });
});

describe('drag-to-reschedule', () => {
  const task = { kind: 'task' as const, start: '2026-11-09', finish: '2026-11-11' };
  it('snaps a pointer travel to whole days', () => {
    expect(dragDays(13, 10)).toBe(1);
    expect(dragDays(-14, 10)).toBe(-1);
    expect(dragDays(4, 10)).toBe(0);
    expect(Object.is(dragDays(-3, 10), -0)).toBe(false);
  });
  it('moves both ends, or only the finish when resizing', () => {
    expect(draggedDates(task, 'move', 2)).toEqual({ start: '2026-11-11', finish: '2026-11-13' });
    expect(draggedDates(task, 'resize', 2)).toEqual({ start: '2026-11-09', finish: '2026-11-13' });
  });
  it('never lets a finish pass the start and keeps a milestone to one day', () => {
    expect(draggedDates(task, 'resize', -9)).toEqual({ start: '2026-11-09', finish: '2026-11-09' });
    const ms = { kind: 'milestone' as const, start: '2026-11-09', finish: '2026-11-09' };
    expect(draggedDates(ms, 'resize', 3)).toEqual({ start: '2026-11-12', finish: '2026-11-12' });
  });
  it('words the variance', () => {
    expect(varianceLabel(null)).toBe('');
    expect(varianceLabel(0)).toBe('On baseline');
    expect(varianceLabel(1)).toBe('1 day late');
    expect(varianceLabel(-3)).toBe('3 days ahead');
  });
});
