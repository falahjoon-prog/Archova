// F7 meeting minutes rules (ai/01 F7, ai/06 F7): the checks that stand between the model's proposed items and the
// person reviewing them. Pure, no IO. Nova may only restate what the notes say: an item whose quote isn't in the notes
// is dropped, an owner is kept only when the quote names them, a due date only when the quote gives one, and a number
// in the item must be in its quote (ai/01 §4: no invented facts).
import { createHash } from 'node:crypto';
import type { MeetingMinutesOutput } from '@archova/ai-prompts';
import { isLocalDate, isoWeekday, type LocalDate } from '@archova/time';
import { normaliseForMatch, quoteAppears } from './citations';

export type MinuteItem = MeetingMinutesOutput['items'][number];

export interface MinutesContext {
  title: string;
  date: LocalDate;
  sections: Array<{ id: string; title: string }>;
  attendees: Array<{ id: string; name: string; company: string }>;
}

/** What the person reviews: the prompt's item, checked, with the prompt ids kept for the caller to map back. */
export interface ReviewedMinuteItem {
  kind: MinuteItem['kind'];
  /** Prompt id (`s2`) of the section, or null when none fits. */
  sectionId: string | null;
  text: string;
  quote: string;
  /** Prompt id (`a3`) of the attendee, or null. */
  ownerId: string | null;
  dueDate: string | null;
}

export interface ReviewedMinutes {
  items: ReviewedMinuteItem[];
  /** Items dropped for a quote that isn't in the notes, no text, or a repeat. */
  dropped: number;
}

/** Fingerprint of what the draft was written from: the cache key. */
export const minutesFingerprint = (notes: string, context: MinutesContext): string =>
  createHash('sha256')
    .update(
      JSON.stringify([
        notes.trim(),
        context.title,
        context.date,
        context.sections,
        context.attendees,
      ]),
    )
    .digest('hex')
    .slice(0, 32);

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bmon(day)?\b/, 1],
  [/\btue(s|sday)?\b/, 2],
  [/\bwed(nesday)?\b/, 3],
  [/\bthu(r|rs|rsday)?\b/, 4],
  [/\bfri(day)?\b/, 5],
  [/\bsat(urday)?\b/, 6],
  [/\bsun(day)?\b/, 7],
];
const MONTHS =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/;
/** Words and shapes that give a date or a day: without one in the quote, a due date was guessed. */
const DATE_CUE = new RegExp(
  `\\d{1,2}[/.-]\\d{1,2}|\\d{4}-\\d{2}-\\d{2}|${MONTHS.source}|\\b(today|tomorrow|tonight|week|fortnight|month|eod|cob)\\b|${WEEKDAYS.map(([r]) => r.source).join('|')}`,
);

/** The weekday names a quote uses (1 Monday .. 7 Sunday). */
const weekdaysIn = (text: string): number[] =>
  WEEKDAYS.filter(([r]) => r.test(text)).map(([, n]) => n);

const numbersIn = (text: string): string[] =>
  (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ''));

/** Whole words of three letters or more, for matching a person or company to what the notes say. */
const tokens = (text: string): string[] =>
  normaliseForMatch(text)
    .split(/[^a-z0-9']+/)
    .filter(
      (t) => t.length >= 3 && !['pty', 'ltd', 'the', 'and', 'group', 'australia'].includes(t),
    );

/** The quote names the attendee: a word of their name (or their company's) is in it. */
function namesOwner(quote: string, a: MinutesContext['attendees'][number]): boolean {
  const words = new Set(tokens(quote));
  return [...tokens(a.name), ...tokens(a.company)].some((t) => words.has(t));
}

export function reviewMinutes(
  out: MeetingMinutesOutput,
  notes: string,
  context: MinutesContext,
): ReviewedMinutes {
  const sectionIds = new Set(context.sections.map((s) => s.id));
  const attendees = new Map(context.attendees.map((a) => [a.id, a]));
  const seen = new Set<string>();
  const items: ReviewedMinuteItem[] = [];
  let dropped = 0;
  for (const raw of out.items) {
    const text = raw.text.trim();
    const quote = raw.quote.trim();
    const key = normaliseForMatch(text);
    if (!text || !quote || !quoteAppears(quote, notes) || seen.has(key)) {
      dropped++;
      continue;
    }
    // A figure in the item that the quote doesn't contain was added by the model.
    const inQuote = new Set(numbersIn(quote));
    if (numbersIn(text).some((n) => !inQuote.has(n))) {
      dropped++;
      continue;
    }
    seen.add(key);

    const owner = raw.ownerId ? attendees.get(raw.ownerId) : undefined;
    const ownerOk = raw.kind === 'action' && owner && namesOwner(quote, owner);

    let dueDate: string | null = null;
    if (
      raw.kind === 'action' &&
      raw.dueDate &&
      isLocalDate(raw.dueDate) &&
      raw.dueDate >= context.date &&
      DATE_CUE.test(normaliseForMatch(quote))
    ) {
      const named = weekdaysIn(normaliseForMatch(quote));
      // "by Friday" must land on a Friday: a date on another weekday was worked out wrongly.
      if (named.length === 0 || named.includes(isoWeekday(raw.dueDate))) dueDate = raw.dueDate;
    }
    items.push({
      kind: raw.kind,
      sectionId: raw.sectionId && sectionIds.has(raw.sectionId) ? raw.sectionId : null,
      text,
      quote,
      ownerId: ownerOk ? raw.ownerId : null,
      dueDate,
    });
  }
  return { items, dropped };
}
