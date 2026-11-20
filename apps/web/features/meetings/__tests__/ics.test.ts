import { describe, expect, it } from 'vitest';
import { buildMeetingIcs, foldLine, icsFileName } from '../lib/ics';

const meeting = {
  id: 'm1',
  title: 'Site meeting; level 2, slab',
  seriesName: 'Weekly site meeting',
  number: 14,
  heldAt: '2027-03-04T22:00:00.000Z',
  location: 'Site office',
  version: 3,
  url: 'https://app.example/meetings/m1',
};

describe('buildMeetingIcs', () => {
  const ics = buildMeetingIcs(meeting);

  it('is a CRLF calendar with one event in UTC and an hour long', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20270304T220000Z\r\n');
    expect(ics).toContain('DTEND:20270304T230000Z\r\n');
  });

  it('keeps one UID per meeting and raises the sequence with each edit', () => {
    expect(ics).toContain('UID:meeting-m1@archova');
    expect(ics).toContain('SEQUENCE:2');
  });

  it('escapes commas and semicolons in text', () => {
    expect(ics).toContain(
      `SUMMARY:Site meeting${String.fromCharCode(92)}; level 2${String.fromCharCode(92)}, slab`,
    );
  });

  it('leaves the location out when there is none', () => {
    expect(buildMeetingIcs({ ...meeting, location: '' })).not.toContain('LOCATION');
  });
});

describe('foldLine', () => {
  it('keeps short lines and folds long ones at 75 octets', () => {
    expect(foldLine('SUMMARY:short')).toBe('SUMMARY:short');
    const folded = foldLine(`DESCRIPTION:${'é'.repeat(80)}`);
    for (const part of folded.split('\r\n'))
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe(`DESCRIPTION:${'é'.repeat(80)}`);
  });
});

describe('icsFileName', () => {
  it('makes a safe name', () => {
    expect(icsFileName('Site meeting #14')).toBe('site-meeting-14.ics');
    expect(icsFileName('!!!')).toBe('meeting.ics');
  });
});
