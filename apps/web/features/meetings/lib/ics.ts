// A meeting as an iCalendar (.ics) file: opens in Outlook, Apple and Google Calendar with no sign-in (integrations/03 M1).
// Times are written in UTC, so every calendar shows the same moment in its own zone. Pure: values in, text out.

export interface IcsMeeting {
  id: string;
  title: string;
  seriesName: string;
  number: number;
  /** ISO date-time the meeting is held. */
  heldAt: string;
  location: string;
  /** Bumped on every edit, so a re-downloaded file updates the calendar entry instead of duplicating it. */
  version: number;
  /** Link back to the minutes. */
  url: string;
}

const BACKSLASH = String.fromCharCode(92);
const escapeText = (s: string) =>
  s
    .replaceAll(BACKSLASH, BACKSLASH + BACKSLASH)
    .replaceAll(';', BACKSLASH + ';')
    .replaceAll(',', BACKSLASH + ',')
    .replace(/\r?\n/g, BACKSLASH + 'n');

const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Lines are folded at 75 octets (RFC 5545 §3.1); continuation lines start with a space. */
export function foldLine(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  // The first line may hold 75 octets, later ones 74 plus the leading space.
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

export function buildMeetingIcs(m: IcsMeeting, durationMinutes = 60): string {
  const start = new Date(m.heldAt);
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Archova//Meetings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:meeting-${m.id}@archova`,
    `DTSTAMP:${stamp(start)}`,
    `SEQUENCE:${Math.max(0, m.version - 1)}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${escapeText(m.title)}`,
    ...(m.location ? [`LOCATION:${escapeText(m.location)}`] : []),
    `DESCRIPTION:${escapeText(`${m.seriesName}, meeting ${m.number}\n${m.url}`)}`,
    `URL:${m.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

export function icsFileName(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${base || 'meeting'}.ics`;
}
