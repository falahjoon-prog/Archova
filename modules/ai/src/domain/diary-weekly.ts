// F4 weekly diary summary rules (ai/01 F4): the week's diary days as facts the model can cite, the totals Nova must not
// work out itself, and the checks on its sentences. Pure, no IO. It reuses the daily summary's fact wording and
// sentence checks, so a weekly sentence is held to the same bar: it cites facts we supplied and states no number
// they don't contain (ai/01 §4).
import { createHash } from 'node:crypto';
import type { DiaryDelayCause, DiaryWeeklyOutput } from '@archova/ai-prompts';
import { addDays, isLocalDate, isoWeekday, type LocalDate } from '@archova/time';
import {
  dayFingerprint,
  isDelayKind,
  lineText,
  reviewSentences,
  totalsText,
  weatherText,
  weekdayOf,
  type DiaryDayForSummary,
  type DiaryFacts,
  type SummarySentence,
  type SummarySource,
} from './diary-summary';

/** Lines kept per day; delays, stand-downs and events come first, so a long day never loses one. */
export const MAX_LINES_PER_DAY = 40;

/** A week runs Monday to Sunday. */
export const isWeekStart = (date: string): date is LocalDate =>
  isLocalDate(date) && isoWeekday(date) === 1;

export const weekDates = (weekStart: LocalDate): LocalDate[] =>
  Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

export interface DelayHours {
  cause: DiaryDelayCause;
  hours: number;
}

export interface WeekFacts extends DiaryFacts {
  /** The days that have an entry, with the prompt id of each (`d1` is Monday). */
  days: Array<{ id: string; date: string; weekday: string }>;
  /** Some day had more lines than `MAX_LINES_PER_DAY`: the facts leave out its quietest lines. */
  truncated: boolean;
  /** Delay line hours by cause over the whole week, most hours first. */
  delayHours: { total: number; byCause: DelayHours[] };
}

const num = (n: number) => String(Math.round(n * 100) / 100);

/** Delays, stand-downs and events (inspections, incidents ...) before the routine lines. */
const weight = (kind: string) =>
  isDelayKind(kind) ? 0 : ['labour', 'plant', 'delivery', 'visitor'].includes(kind) ? 2 : 1;

function keptLines(day: DiaryDayForSummary) {
  if (day.lines.length <= MAX_LINES_PER_DAY) return { lines: day.lines, truncated: false };
  const keep = new Set(
    day.lines
      .map((l, i) => ({ i, w: weight(l.kind) }))
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .slice(0, MAX_LINES_PER_DAY)
      .map((x) => x.i),
  );
  return { lines: day.lines.filter((_, i) => keep.has(i)), truncated: true };
}

/** The week's days (any order, only those the caller can read) as numbered facts, plus the week's totals. */
export function weekFacts(weekStart: LocalDate, days: readonly DiaryDayForSummary[]): WeekFacts {
  const dates = weekDates(weekStart);
  const ordered = days
    .filter((d) => dates.includes(d.date as LocalDate))
    .sort((a, b) => a.date.localeCompare(b.date));
  const facts: DiaryFacts['facts'] = [];
  const sources = new Map<string, SummarySource>();
  const delayIds: string[] = [];
  const out: WeekFacts['days'] = [];
  let truncated = false;

  let labourHours = 0;
  let peak: { people: number; weekday: string } | null = null;
  let standDowns = 0;
  const byCause = new Map<DiaryDelayCause, number>();

  for (const day of ordered) {
    const n = dates.indexOf(day.date as LocalDate) + 1;
    const d = `d${n}`;
    const weekday = weekdayOf(day.date);
    out.push({ id: d, date: day.date, weekday });

    const weather = weatherText(day.weather);
    if (weather) {
      facts.push({ id: `${d}w`, kind: 'weather', text: weather });
      sources.set(`${d}w`, { kind: 'weather', id: null, date: day.date });
    }
    const totals = totalsText(day.lines);
    if (totals) {
      facts.push({ id: `${d}t`, kind: 'totals', text: totals });
      sources.set(`${d}t`, { kind: 'totals', id: null, date: day.date });
    }
    const kept = keptLines(day);
    truncated ||= kept.truncated;
    for (const [i, l] of kept.lines.entries()) {
      const id = `${d}l${i + 1}`;
      facts.push({ id, kind: l.kind, text: lineText(l) });
      sources.set(id, { kind: l.kind, id: l.id, date: day.date });
      if (isDelayKind(l.kind)) delayIds.push(id);
    }

    // The week's totals count every line, including any left out of the facts.
    const labour = day.lines.filter((l) => l.kind === 'labour');
    labourHours += labour.reduce((h, l) => h + (l.hours ?? 0), 0);
    const people = labour.reduce((p, l) => p + (l.headcount ?? 0), 0);
    if (people > (peak?.people ?? 0)) peak = { people, weekday };
    for (const l of day.lines) {
      if (l.kind === 'stand_down') standDowns++;
      if (l.kind === 'delay' && l.hours)
        byCause.set(l.delayCause ?? 'other', (byCause.get(l.delayCause ?? 'other') ?? 0) + l.hours);
    }
  }

  const delay = [...byCause].map(([cause, hours]): DelayHours => ({ cause, hours: round(hours) }));
  delay.sort((a, b) => b.hours - a.hours || a.cause.localeCompare(b.cause));
  const delayTotal = round(delay.reduce((h, c) => h + c.hours, 0));
  if (facts.length) {
    const parts = [
      `Days with a diary entry: ${ordered.length} of 7`,
      labourHours ? `labour ${num(labourHours)} hours` : null,
      peak ? `most people on site in a day: ${peak.people} (${peak.weekday})` : null,
      delayTotal
        ? `delay hours ${num(delayTotal)} (${delay.map((c) => `${c.cause} ${num(c.hours)}`).join(', ')})`
        : null,
      standDowns ? `stand-down lines: ${standDowns}` : null,
    ].filter(Boolean);
    facts.push({ id: 'wt', kind: 'week_totals', text: `${parts.join('; ')}` });
    sources.set('wt', { kind: 'totals', id: null });
  }
  return {
    facts,
    sources,
    delayIds,
    days: out,
    truncated,
    delayHours: { total: delayTotal, byCause: delay },
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface ReviewedWeekly {
  sentences: SummarySentence[];
  /** Delay and stand-down lines no kept sentence mentions: shown to the person, so none is lost. */
  unmentionedDelays: SummarySource[];
  /** Sentences removed because they cited nothing valid or stated a number their sources don't contain. */
  dropped: number;
}

/** The checks between the model and the person: sources must be facts we supplied, numbers must be in them. */
export function reviewWeeklySummary(
  out: DiaryWeeklyOutput,
  built: WeekFacts,
  weekStart: LocalDate,
): ReviewedWeekly {
  const { sentences, mentioned, dropped } = reviewSentences(out.sentences, built, [
    ...weekDates(weekStart),
  ]);
  return {
    sentences,
    unmentionedDelays: built.delayIds
      .filter((id) => !mentioned.has(id))
      .map((id) => built.sources.get(id)!),
    dropped,
  };
}

/** A fingerprint of everything a weekly summary is written from: the cache key, with the asker. */
export function weekFingerprint(weekStart: string, days: readonly DiaryDayForSummary[]): string {
  return createHash('sha256')
    .update(JSON.stringify([weekStart, days.map(dayFingerprint).sort()]))
    .digest('hex')
    .slice(0, 32);
}
