// F4 site diary summary rules (ai/01 F4, product/05). Pure functions: turn a diary day into facts the model can
// cite, and check the summary before anyone sees it, so every sentence is traceable to an entry and no number is
// invented (ai/01 §4).
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

/** The day as numbered facts. Lines keep their own wording; structured fields are spelled out beside it. */
export function diaryFacts(day: DiaryDayForSummary): DiaryFacts {
  const facts: DiaryFact[] = [];
  const sources = new Map<string, SummarySource>();
  const delayIds: string[] = [];
  const w = day.weather;
  if (w && (w.summary || w.minC !== null || w.maxC !== null || w.rainMm !== null)) {
    const parts = [
      w.summary,
      w.minC !== null || w.maxC !== null
        ? `temperature ${w.minC !== null ? num(w.minC) : '?'} to ${w.maxC !== null ? num(w.maxC) : '?'} °C`
        : null,
      w.rainMm !== null ? `rain ${num(w.rainMm)} mm` : null,
      w.lostHours ? `${num(w.lostHours)} hours lost to weather` : null,
    ].filter(Boolean);
    facts.push({ id: 'w', kind: 'weather', text: parts.join('; ') });
    sources.set('w', WEATHER_SOURCE);
  }
  const labour = day.lines.filter((l) => l.kind === 'labour');
  if (labour.length) {
    const people = labour.reduce((n, l) => n + (l.headcount ?? 0), 0);
    const hours = labour.reduce((n, l) => n + (l.hours ?? 0), 0);
    const companies = new Set(labour.map((l) => l.company).filter(Boolean)).size;
    facts.push({
      id: 't',
      kind: 'totals',
      text: `${people} people, ${num(hours)} hours, ${companies} ${companies === 1 ? 'company' : 'companies'} on site`,
    });
    sources.set('t', TOTALS_SOURCE);
  }
  for (const [i, l] of day.lines.slice(0, MAX_FACTS - facts.length).entries()) {
    const id = `l${i + 1}`;
    const fields = [
      l.company,
      l.headcount !== null ? `${l.headcount} people` : null,
      l.hours !== null ? `${num(l.hours)} hours` : null,
      l.delayCause ? `cause: ${l.delayCause}` : null,
      l.at ? `at ${l.at}` : null,
    ].filter(Boolean);
    const photos = l.photoCaptions.length ? ` (photos: ${l.photoCaptions.join('; ')})` : '';
    const text = [fields.join(', '), l.text.trim()].filter(Boolean).join(' | ') + photos;
    facts.push({ id, kind: l.kind, text: text || '(no detail)' });
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
function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.:/,-]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));
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
  const mentioned = new Set<string>();
  let dropped = 0;
  const sentences: SummarySentence[] = [];
  for (const s of out.sentences) {
    const ids = [...new Set(s.sources)].filter((id) => text.has(id));
    const hay = normaliseForMatch(
      [day.date, ...ids.map((id) => text.get(id)!)].join('\n').replace(/,/g, ''),
    ).replace(/\s+/g, '');
    if (!ids.length || !numbersIn(s.text).every((n) => hay.includes(n))) {
      dropped++;
      continue;
    }
    ids.forEach((id) => mentioned.add(id));
    sentences.push({ text: s.text.trim(), sources: ids.map((id) => built.sources.get(id)!) });
  }

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
