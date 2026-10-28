import { describe, expect, it } from 'vitest';
import type { LocalDate } from '@archova/time';
import type { DiaryDayForSummary } from '../../src/domain/diary-summary';
import {
  MAX_LINES_PER_DAY,
  isWeekStart,
  reviewWeeklySummary,
  weekDates,
  weekFacts,
  weekFingerprint,
} from '../../src/domain/diary-weekly';

const MONDAY = '2026-10-19' as LocalDate;

type Line = DiaryDayForSummary['lines'][number];
let n = 0;
const line = (kind: string, text: string, extra: Partial<Line> = {}): Line => ({
  id: `line-${++n}`,
  kind,
  text,
  company: null,
  headcount: null,
  hours: null,
  delayCause: null,
  at: null,
  photoCaptions: [],
  ...extra,
});
const day = (
  date: string,
  lines: Line[],
  weather: DiaryDayForSummary['weather'] = null,
): DiaryDayForSummary => ({
  entryId: `entry-${date}`,
  date,
  timeZone: 'Australia/Brisbane',
  status: 'draft',
  version: 1,
  weather,
  lines,
});

const week = () => {
  n = 0;
  return [
    day(
      '2026-10-19',
      [
        line('labour', 'L4 forms', { company: 'Harbour Formwork', headcount: 8, hours: 64 }),
        line('delay', 'Pour postponed, rain', { delayCause: 'weather', hours: 5.5 }),
      ],
      { summary: 'Heavy rain', minC: 9, maxC: 15, rainMm: 32, lostHours: 5.5 },
    ),
    day('2026-10-21', [
      line('labour', 'L4 reo', { company: 'Coastal Steel', headcount: 12, hours: 96 }),
      line('delay', 'Waiting on RFI 014', { delayCause: 'design', hours: 3 }),
      line('delay', 'More rain', { delayCause: 'weather', hours: 1.5 }),
      line('stand_down', 'Crew stood down'),
    ]),
  ];
};

describe('weeks', () => {
  it('runs Monday to Sunday', () => {
    expect(isWeekStart('2026-10-19')).toBe(true);
    expect(isWeekStart('2026-10-20')).toBe(false);
    expect(isWeekStart('2026-10-32')).toBe(false);
    expect(isWeekStart('next week')).toBe(false);
    expect(weekDates(MONDAY)[0]).toBe('2026-10-19');
    expect(weekDates(MONDAY)[6]).toBe('2026-10-25');
  });
});

describe('weekFacts', () => {
  it('numbers each day by its place in the week and keeps the day on every source', () => {
    const w = weekFacts(MONDAY, week());
    expect(w.days).toEqual([
      { id: 'd1', date: '2026-10-19', weekday: 'Monday' },
      { id: 'd3', date: '2026-10-21', weekday: 'Wednesday' },
    ]);
    const ids = w.facts.map((f) => f.id);
    expect(ids).toEqual([
      'd1w',
      'd1t',
      'd1l1',
      'd1l2',
      'd3t',
      'd3l1',
      'd3l2',
      'd3l3',
      'd3l4',
      'wt',
    ]);
    expect(w.sources.get('d3l2')).toEqual({ kind: 'delay', id: 'line-4', date: '2026-10-21' });
    expect(w.sources.get('d1w')).toEqual({ kind: 'weather', id: null, date: '2026-10-19' });
    expect(w.sources.get('wt')).toEqual({ kind: 'totals', id: null });
    expect(w.delayIds).toEqual(['d1l2', 'd3l2', 'd3l3', 'd3l4']);
  });

  it('adds the week up in code: labour hours, busiest day and delay hours by cause', () => {
    const w = weekFacts(MONDAY, week());
    expect(w.delayHours).toEqual({
      total: 10,
      byCause: [
        { cause: 'weather', hours: 7 },
        { cause: 'design', hours: 3 },
      ],
    });
    const wt = w.facts.find((f) => f.id === 'wt')!.text;
    expect(wt).toContain('Days with a diary entry: 2 of 7');
    expect(wt).toContain('labour 160 hours');
    expect(wt).toContain('most people on site in a day: 12 (Wednesday)');
    expect(wt).toContain('delay hours 10 (weather 7, design 3)');
    expect(wt).toContain('stand-down lines: 1');
  });

  it('ignores days outside the week, and says nothing when there is nothing to say', () => {
    const w = weekFacts(MONDAY, [day('2026-10-26', [line('labour', 'x', { headcount: 1 })])]);
    expect(w.days).toEqual([]);
    expect(w.facts).toEqual([]);
    const empty = weekFacts(MONDAY, [day('2026-10-20', [])]);
    expect(empty.facts).toEqual([]);
    expect(empty.days).toHaveLength(1);
  });

  it('leaves out the routine lines of a long day, never its delays or events', () => {
    const lines = [
      ...Array.from({ length: 60 }, (_, i) =>
        line('labour', `area ${i + 1}`, { headcount: 1, hours: 8 }),
      ),
      line('inspection', 'Engineer passed L4 reo'),
      line('delay', 'Pump broke down', { delayCause: 'subcontractor', hours: 4 }),
    ];
    const w = weekFacts(MONDAY, [day('2026-10-20', lines)]);
    expect(w.truncated).toBe(true);
    const dayLines = w.facts.filter((f) => /^d2l/.test(f.id));
    expect(dayLines).toHaveLength(MAX_LINES_PER_DAY);
    expect(dayLines.some((f) => f.kind === 'delay')).toBe(true);
    expect(dayLines.some((f) => f.kind === 'inspection')).toBe(true);
    expect(w.delayIds).toHaveLength(1);
    // The totals still count every line.
    expect(w.facts.find((f) => f.id === 'd2t')!.text).toContain('60 people, 480 hours');
    expect(w.facts.find((f) => f.id === 'wt')!.text).toContain('labour 480 hours');
  });
});

describe('reviewWeeklySummary', () => {
  const built = weekFacts(MONDAY, week());

  it('keeps sentences whose sources and numbers check out and drops the rest', () => {
    const r = reviewWeeklySummary(
      {
        sentences: [
          { text: 'Rain on Monday lost 5.5 hours.', sources: ['d1w', 'd1l2'] },
          { text: 'A total of 99 hours were lost.', sources: ['wt'] },
          { text: 'The crane failed.', sources: ['d9l1'] },
          { text: 'Work continued on level 4.', sources: [] },
          { text: 'There were 12 people on site on 21 October.', sources: ['d3t', 'd3l1'] },
        ],
      },
      built,
      MONDAY,
    );
    expect(r.sentences.map((s) => s.text)).toEqual([
      'Rain on Monday lost 5.5 hours.',
      'There were 12 people on site on 21 October.',
    ]);
    expect(r.dropped).toBe(3);
    expect(r.sentences[0]!.sources).toEqual([
      { kind: 'weather', id: null, date: '2026-10-19' },
      { kind: 'delay', id: 'line-2', date: '2026-10-19' },
    ]);
  });

  it('lists the delay and stand-down lines no kept sentence mentions', () => {
    const r = reviewWeeklySummary(
      {
        sentences: [
          { text: 'Rain stopped the pour on Monday.', sources: ['d1l2'] },
          { text: 'Delay hours were 10.', sources: ['wt'] },
        ],
      },
      built,
      MONDAY,
    );
    expect(r.unmentionedDelays.map((s) => s.id)).toEqual(['line-4', 'line-5', 'line-6']);
  });
});

describe('weekFingerprint', () => {
  it('changes when a line changes and not with the order the days arrive in', () => {
    const a = weekFingerprint(MONDAY, week());
    expect(weekFingerprint(MONDAY, [...week()].reverse())).not.toBe('');
    const days = week();
    expect(weekFingerprint(MONDAY, [days[1]!, days[0]!])).toBe(weekFingerprint(MONDAY, days));
    const edited = week();
    edited[1]!.lines[0]!.hours = 100;
    expect(weekFingerprint(MONDAY, edited)).not.toBe(a);
    expect(weekFingerprint('2026-10-26', week())).not.toBe(a);
  });
});
