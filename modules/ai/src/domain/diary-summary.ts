// F4 site diary summary rules (ai/01 F4, product/05). Pure functions: turn a diary day into facts the model can
// cite, and check the summary before anyone sees it, so every sentence is traceable to an entry and no number is
// invented (ai/01 §4).
import { createHash } from 'node:crypto';
import type { DiaryDelayCause, DiaryFact, DiarySummaryOutput } from '@archova/ai-prompts';
import { DIARY_DELAY_CAUSES } from '@archova/ai-prompts';
import { isoWeekday } from '@archova/time';
import { normaliseForMatch } from './citations';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** "Monday" for a site-local date. */
export const weekdayOf = (date: string) => WEEKDAYS[isoWeekday(date) - 1]!;

/** What `diary.api.dayForSummary` returns: the lines the caller may see, with internal ids. */
export interface DiaryDayForSummary {
  entryId: string;
  /** Site-local date (X34). */
  date: string;
  timeZone: string;
  status: 'draft' | 'submitted' | 'signed_off';
  /** Bumps on any change to the entry or its lines; summaries are cached per version. */
  version: number;
  weather: {
    summary: string | null;
    minC: number | null;
    maxC: number | null;
    rainMm: number | null;
    lostHours: number | null;
  } | null;
  lines: ReadonlyArray<{
    id: string;
    /** labour, plant, delivery, visitor, delay, stand_down, or an event's own kind (inspection, safety, ...). */
    kind: string;
    text: string;
    company: string | null;
    headcount: number | null;
    hours: number | null;
    delayCause: DiaryDelayCause | null;
    /** Site-local HH:mm. */
    at: string | null;
    photoCaptions: readonly string[];
  }>;
}

/** What a stored sentence points at: a diary line (its kind and id), or the day's weather or labour totals. */
export interface SummarySource {
  kind: string;
  /** The line's id; null for `weather` and `totals`. */
  id: string | null;
  /** The day it comes from; set on a weekly summary's sources only (a daily summary is of one day). */
  date?: string;
}
export const WEATHER_SOURCE: SummarySource = { kind: 'weather', id: null };
export const TOTALS_SOURCE: SummarySource = { kind: 'totals', id: null };

export interface DiaryFacts {
  facts: DiaryFact[];
  /** Prompt id (`l1`, `w`, `t`) → what it stands for. */
  sources: Map<string, SummarySource>;
  /** Prompt ids of delay and stand-down lines: each must be mentioned. */
  delayIds: string[];
}

const DELAY_KINDS = new Set(['delay', 'stand_down']);
const MAX_FACTS = 250;

const num = (n: number) => String(Math.round(n * 100) / 100);

type DayLine = DiaryDayForSummary['lines'][number];

/** The weather as one fact, or null when the day records none. */
export function weatherText(w: DiaryDayForSummary['weather']): string | null {
  if (!w || !(w.summary || w.minC !== null || w.maxC !== null || w.rainMm !== null)) return null;
  return [
    w.summary,
    w.minC !== null || w.maxC !== null
      ? `temperature ${w.minC !== null ? num(w.minC) : '?'} to ${w.maxC !== null ? num(w.maxC) : '?'} °C`
      : null,
    w.rainMm !== null ? `rain ${num(w.rainMm)} mm` : null,
    w.lostHours ? `${num(w.lostHours)} hours lost to weather` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

/** Labour totals calculated in code, or null when the day has no labour lines. */
export function totalsText(lines: readonly DayLine[]): string | null {
  const labour = lines.filter((l) => l.kind === 'labour');
  if (!labour.length) return null;
  const people = labour.reduce((n, l) => n + (l.headcount ?? 0), 0);
  const hours = labour.reduce((n, l) => n + (l.hours ?? 0), 0);
  const companies = new Set(labour.map((l) => l.company).filter(Boolean)).size;
  return `${people} people, ${num(hours)} hours, ${companies} ${companies === 1 ? 'company' : 'companies'} on site`;
}

/** A line with its structured fields spelled out beside its own wording. */
export function lineText(l: DayLine): string {
  const fields = [
    l.company,
    l.headcount !== null ? `${l.headcount} people` : null,
    l.hours !== null ? `${num(l.hours)} hours` : null,
    l.delayCause ? `cause: ${l.delayCause}` : null,
    l.at ? `at ${l.at}` : null,
  ].filter(Boolean);
  const photos = l.photoCaptions.length ? ` (photos: ${l.photoCaptions.join('; ')})` : '';
  const text = [fields.join(', '), l.text.trim()].filter(Boolean).join(' | ') + photos;
  return text || '(no detail)';
}

export const isDelayKind = (kind: string) => DELAY_KINDS.has(kind);

/** The day as numbered facts. Lines keep their own wording; structured fields are spelled out beside it. */
export function diaryFacts(day: DiaryDayForSummary): DiaryFacts {
  const facts: DiaryFact[] = [];
  const sources = new Map<string, SummarySource>();
  const delayIds: string[] = [];
  const weather = weatherText(day.weather);
  if (weather) {
    facts.push({ id: 'w', kind: 'weather', text: weather });
    sources.set('w', WEATHER_SOURCE);
  }
  const totals = totalsText(day.lines);
  if (totals) {
    facts.push({ id: 't', kind: 'totals', text: totals });
    sources.set('t', TOTALS_SOURCE);
  }
  for (const [i, l] of day.lines.slice(0, MAX_FACTS - facts.length).entries()) {
    const id = `l${i + 1}`;
    facts.push({ id, kind: l.kind, text: lineText(l) });
    sources.set(id, { kind: l.kind, id: l.id });
    if (DELAY_KINDS.has(l.kind)) delayIds.push(id);
  }
  return { facts, sources, delayIds };
}

export interface SummarySentence {
  text: string;
  sources: SummarySource[];
}

export interface ReviewedSummary {
  sentences: SummarySentence[];
  possibleDelay: { flagged: boolean; cause: DiaryDelayCause | null; sources: SummarySource[] };
  /** Delay and stand-down lines no kept sentence mentions: shown to the site manager, so none is lost. */
  unmentionedDelays: SummarySource[];
  /** Sentences removed because they cited nothing valid or stated a number their sources don't contain. */
  dropped: number;
}

/** Numbers, times and dates: every one must appear in the facts the sentence cites. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.:/,-]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
}

/** A sentence the model wrote: its words and the ids of the facts it says it used. */
export interface ModelSentence {
  text: string;
  sources: readonly string[];
}

/**
 * The sentence checks shared by the daily and weekly summaries: a sentence is kept only when it cites at least one
 * fact we supplied and every number, time and date in it appears in those facts (or in `known`, the dates of the
 * period). Returns the kept sentences with their sources, the facts they cite and how many were dropped.
 */
export function reviewSentences(
  modelSentences: readonly ModelSentence[],
  built: DiaryFacts,
  known: readonly string[],
): { sentences: SummarySentence[]; mentioned: Set<string>; dropped: number } {
  const text = new Map(built.facts.map((f) => [f.id, f.text]));
  const mentioned = new Set<string>();
  let dropped = 0;
  const sentences: SummarySentence[] = [];
  for (const s of modelSentences) {
    const ids = [...new Set(s.sources)].filter((id) => text.has(id));
    const hay = normaliseForMatch(
      [...known, ...ids.map((id) => text.get(id)!)].join('\n').replace(/,/g, ''),
    ).replace(/\s+/g, '');
    if (!ids.length || !numbersIn(s.text).every((n) => hay.includes(n))) {
      dropped++;
      continue;
    }
    ids.forEach((id) => mentioned.add(id));
    sentences.push({ text: s.text.trim(), sources: ids.map((id) => built.sources.get(id)!) });
  }
  return { sentences, mentioned, dropped };
}

/**
 * The checks between the model and the site manager: sources must be facts we supplied, numbers must be in those
 * facts, and a delay line the summary skipped is listed. "Possible delay" is always raised when the day has a
 * delay or stand-down line, whatever the model said.
 */
export function reviewDiarySummary(
  out: DiarySummaryOutput,
  built: DiaryFacts,
  day: Pick<DiaryDayForSummary, 'date' | 'lines'>,
): ReviewedSummary {
  const text = new Map(built.facts.map((f) => [f.id, f.text]));
  const { sentences, mentioned, dropped } = reviewSentences(out.sentences, built, [day.date]);

  const delayIds = new Set(built.delayIds.map((id) => built.sources.get(id)!.id));
  const modelIds = out.possibleDelay.sources.filter((id) => text.has(id));
  const flagged = delayIds.size > 0 || (out.possibleDelay.flagged && modelIds.length > 0);
  const recordedCause = day.lines.find((l) => delayIds.has(l.id) && l.delayCause)?.delayCause;
  const cause = !flagged
    ? null
    : (recordedCause ??
      (out.possibleDelay.cause && DIARY_DELAY_CAUSES.includes(out.possibleDelay.cause)
        ? out.possibleDelay.cause
        : 'other'));
  return {
    sentences,
    possibleDelay: {
      flagged,
      cause,
      sources: flagged
        ? [...new Set([...built.delayIds, ...modelIds])].map((id) => built.sources.get(id)!)
        : [],
    },
    unmentionedDelays: built.delayIds
      .filter((id) => !mentioned.has(id))
      .map((id) => built.sources.get(id)!),
    dropped,
  };
}

/**
 * A fingerprint of everything a summary is written from. The entry's own version doesn't change when a line is
 * added, edited or removed, so the cache is keyed on the lines and weather themselves.
 */
export function dayFingerprint(day: DiaryDayForSummary): string {
  const lines = day.lines.map((l) => [
    l.id,
    l.kind,
    l.text,
    l.company,
    l.headcount,
    l.hours,
    l.delayCause,
    l.at,
    l.photoCaptions,
  ]);
  return createHash('sha256')
    .update(JSON.stringify([day.entryId, day.date, day.status, day.version, day.weather, lines]))
    .digest('hex')
    .slice(0, 32);
}
