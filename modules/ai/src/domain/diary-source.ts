// Site diary days as Ask Nova sources (ai/03 §3, one page of text per day). `diary` supplies every submitted or
// signed-off day; this turns one into the text that is chunked and embedded, and into a revision id that changes
// whenever that text does, so an amended line, a late edit or a sign-off re-indexes and the old chunks drop out.
import { createHash } from 'node:crypto';
import {
  weekdayOf,
  lineText,
  totalsText,
  weatherText,
  type DiaryDayForSummary,
} from './diary-summary';

/** What `diary.api.aiSources` returns for one day: the summary's view of it plus the day's own words. */
export interface DiarySource extends DiaryDayForSummary {
  siteConditions: string | null;
  notes: string;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "Monday 12 October 2026" for a site-local date. */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${weekdayOf(date)} ${d} ${MONTHS[m! - 1]} ${y}`;
}

/** The title a diary day is cited by. */
export const diaryTitle = (date: string) => `Site diary ${longDate(date)}`;

const status = (s: DiarySource['status']) => s.replace('_', ' ');

/** Headings for the line kinds the diary has; an event keeps its own kind ("inspection") as its heading. */
const SECTIONS: Array<[kind: string, heading: string]> = [
  ['labour', 'Labour'],
  ['plant', 'Plant'],
  ['delivery', 'Deliveries'],
  ['delay', 'Delays'],
  ['stand_down', 'Stand-downs'],
  ['visitor', 'Visitors'],
];

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

/** A day as one page of text: the date and status, weather, notes, labour totals, then each kind of line. */
export function diaryText(d: DiarySource): string {
  const parts = [`${diaryTitle(d.date)} (${status(d.status)})`];
  const weather = weatherText(d.weather);
  if (weather) parts.push(`Weather: ${weather}`);
  if (d.siteConditions) parts.push(`Site conditions:\n${d.siteConditions}`);
  if (d.notes) parts.push(`Notes:\n${d.notes}`);
  const totals = totalsText(d.lines);
  if (totals) parts.push(`Labour on site: ${totals}`);
  const known = new Set(SECTIONS.map(([kind]) => kind));
  const section = (heading: string, kinds: (k: string) => boolean) => {
    const lines = d.lines.filter((l) => kinds(l.kind));
    if (lines.length) parts.push(`${heading}:\n${lines.map((l) => `- ${lineText(l)}`).join('\n')}`);
  };
  for (const [kind, heading] of SECTIONS) section(heading, (k) => k === kind);
  // Events (inspections, safety matters, instructions) keep their own kind as the heading.
  for (const kind of [...new Set(d.lines.map((l) => l.kind))].filter((k) => !known.has(k)))
    section(capital(kind), (k) => k === kind);
  return parts.join('\n\n');
}

/**
 * A UUID taken from a hash of everything the indexed text depends on. The same day gives the same id, so a re-run
 * skips it; any change to what the text says gives a new one.
 */
export function diaryRevisionId(d: DiarySource): string {
  const h = createHash('sha256')
    .update(JSON.stringify([d.entryId, d.date, d.status, diaryText(d)]))
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
