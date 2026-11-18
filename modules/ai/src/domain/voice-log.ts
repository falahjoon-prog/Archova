// Voice log rules (mobile F14): the checks between the model's proposed records and the person reviewing them on
// their phone. Pure, no IO. Nova may only restate what was said: an item whose quote isn't in the transcript is
// dropped, a number in the text or the hours must be in the quote, and a due date is kept only when the quote gives
// one that lands on the weekday it names (ai/01 §4: no invented facts).
import { createHash } from 'node:crypto';
import type { VoiceLogOutput } from '@archova/ai-prompts';
import { isLocalDate, isoWeekday, type LocalDate } from '@archova/time';
import { normaliseForMatch, quoteAppears } from './citations';
import { DATE_CUE, numbersIn, weekdaysIn } from './meeting-minutes';

export type VoiceLogItem = VoiceLogOutput['items'][number];

/** What the person reviews: one proposed record, checked. Fields that don't apply to its kind are null. */
export interface ReviewedVoiceItem {
  kind: VoiceLogItem['kind'];
  text: string;
  quote: string;
  hours: number | null;
  delayType: VoiceLogItem['delayType'];
  severity: VoiceLogItem['severity'];
  dueDate: string | null;
}

export interface ReviewedVoiceLog {
  items: ReviewedVoiceItem[];
  /** Items dropped for a quote that isn't in the transcript, no text, an added figure, or a repeat. */
  dropped: number;
}

export const voiceLogFingerprint = (date: string, transcript: string): string =>
  createHash('sha256')
    .update(JSON.stringify([date, transcript.trim()]))
    .digest('hex')
    .slice(0, 32);

const WORD_DIGITS: Array<[RegExp, string]> = [
  [/\bhalf an? hour\b/g, '0.5 hour'],
  ...['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'].map(
    (w, i): [RegExp, string] => [new RegExp(`\\b${w}\\b`, 'g'), String(i)],
  ),
  [/\beleven\b/g, '11'],
  [/\btwelve\b/g, '12'],
];
/** Recognisers write "two hours" or "2 hours"; compare numbers either way. */
const spokenNumbers = (text: string): Set<string> => {
  let t = normaliseForMatch(text);
  for (const [re, d] of WORD_DIGITS) t = t.replace(re, d);
  return new Set(numbersIn(t));
};

const isQuarter = (h: number) => Number.isFinite(h) && h >= 0 && h <= 24 && Number.isInteger(h * 4);

export function reviewVoiceLog(
  out: VoiceLogOutput,
  transcript: string,
  date: LocalDate,
): ReviewedVoiceLog {
  const seen = new Set<string>();
  const items: ReviewedVoiceItem[] = [];
  let dropped = 0;
  for (const raw of out.items) {
    const text = raw.text.trim();
    const quote = raw.quote.trim();
    const key = `${raw.kind}|${normaliseForMatch(text)}`;
    if (!text || !quote || !quoteAppears(quote, transcript) || seen.has(key)) {
      dropped++;
      continue;
    }
    const inQuote = spokenNumbers(quote);
    if ([...spokenNumbers(text)].some((n) => !inQuote.has(n))) {
      dropped++;
      continue;
    }
    seen.add(key);

    let hours: number | null = null;
    if (raw.kind === 'delay' && raw.hours !== null && isQuarter(raw.hours)) {
      // Hours are kept only when the quote says a number of them (or half an hour).
      if (
        raw.hours === 0.5
          ? /half an? hour|0?\.5/.test(normaliseForMatch(quote))
          : inQuote.has(String(raw.hours))
      )
        hours = raw.hours;
    }

    let dueDate: string | null = null;
    if (
      raw.kind === 'task' &&
      raw.dueDate &&
      isLocalDate(raw.dueDate) &&
      raw.dueDate >= date &&
      DATE_CUE.test(normaliseForMatch(quote))
    ) {
      const named = weekdaysIn(normaliseForMatch(quote));
      if (named.length === 0 || named.includes(isoWeekday(raw.dueDate))) dueDate = raw.dueDate;
    }
    items.push({
      kind: raw.kind,
      text,
      quote,
      hours,
      delayType: raw.kind === 'delay' ? (raw.delayType ?? 'other') : null,
      severity: raw.kind === 'observation' ? (raw.severity ?? 'minor') : null,
      dueDate,
    });
  }
  return { items, dropped };
}
