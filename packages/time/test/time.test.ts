import { describe, expect, it } from 'vitest';
import {
  LocalTimeError,
  addBusinessDays,
  addDays,
  daysBetween,
  endOfLocalDay,
  isLocalDate,
  isValidTimeZone,
  localDateOf,
  normalizeTimeZone,
  startOfLocalDay,
  utcOffsetMinutes,
  zonedParts,
  zonedToUtc,
} from '../src';

// NSW daylight saving 2026: ends Sun 5 Apr (03:00 -> 02:00), starts Sun 4 Oct (02:00 -> 03:00). QLD has none.

describe('time zones', () => {
  it('accepts IANA names and rejects offsets and abbreviations', () => {
    for (const tz of [
      'Australia/Sydney',
      'Australia/Brisbane',
      'Australia/Lord_Howe',
      'UTC',
      'Europe/London',
      'America/New_York',
      'Pacific/Auckland',
    ])
      expect(isValidTimeZone(tz), tz).toBe(true);
    for (const tz of ['', 'AEST', '+10:00', 'Australia/Gotham', 'Sydney', '../etc/passwd'])
      expect(isValidTimeZone(tz), tz).toBe(false);
  });

  it('normalises spelling', () => {
    expect(normalizeTimeZone('australia/perth')).toBe('Australia/Perth');
  });

  it('knows each state differs, and only some observe daylight saving', () => {
    const summer = '2026-01-15T00:00:00Z';
    const winter = '2026-07-15T00:00:00Z';
    const offsets = (tz: string) => [utcOffsetMinutes(summer, tz), utcOffsetMinutes(winter, tz)];
    expect(offsets('Australia/Sydney')).toEqual([660, 600]);
    expect(offsets('Australia/Melbourne')).toEqual([660, 600]);
    expect(offsets('Australia/Hobart')).toEqual([660, 600]);
    expect(offsets('Australia/Brisbane')).toEqual([600, 600]);
    expect(offsets('Australia/Adelaide')).toEqual([630, 570]);
    expect(offsets('Australia/Darwin')).toEqual([570, 570]);
    expect(offsets('Australia/Perth')).toEqual([480, 480]);
    expect(offsets('Australia/Lord_Howe')).toEqual([660, 630]);
    expect(offsets('Europe/London')).toEqual([0, 60]);
  });

  it('puts an instant on the right local calendar day', () => {
    // 14:30Z is 00:30 next day in Sydney summer, still 22:30 in Perth.
    const t = '2026-01-15T14:30:00Z';
    expect(localDateOf(t, 'Australia/Sydney')).toBe('2026-01-16');
    expect(localDateOf(t, 'Australia/Brisbane')).toBe('2026-01-16');
    expect(localDateOf(t, 'Australia/Perth')).toBe('2026-01-15');
    expect(zonedParts(t, 'Australia/Sydney')).toMatchObject({ hour: 1, minute: 30, weekday: 5 });
  });

  it('converts wall-clock time to UTC', () => {
    expect(zonedToUtc('2026-07-01', '07:00', 'Australia/Brisbane').toISOString()).toBe(
      '2026-06-30T21:00:00.000Z',
    );
    expect(zonedToUtc('2026-01-01', '07:00', 'Australia/Sydney').toISOString()).toBe(
      '2025-12-31T20:00:00.000Z',
    );
  });

  it('moves a time skipped by daylight saving forward, or rejects it', () => {
    // 02:30 on 4 Oct 2026 never happens in Sydney; compatible reads it as 03:30 AEDT.
    expect(zonedToUtc('2026-10-04', '02:30', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-03T16:30:00.000Z',
    );
    expect(() => zonedToUtc('2026-10-04', '02:30', 'Australia/Sydney', 'reject')).toThrow(
      LocalTimeError,
    );
    // The same wall time is ordinary in Brisbane.
    expect(zonedToUtc('2026-10-04', '02:30', 'Australia/Brisbane').toISOString()).toBe(
      '2026-10-03T16:30:00.000Z',
    );
  });

  it('picks the earlier of a repeated time unless asked for the later', () => {
    // 02:30 on 5 Apr 2026 happens twice in Sydney (AEDT then AEST).
    expect(zonedToUtc('2026-04-05', '02:30', 'Australia/Sydney').toISOString()).toBe(
      '2026-04-04T15:30:00.000Z',
    );
    expect(zonedToUtc('2026-04-05', '02:30', 'Australia/Sydney', 'later').toISOString()).toBe(
      '2026-04-04T16:30:00.000Z',
    );
  });

  it('gives local days their real length', () => {
    const hours = (d: string, tz: string) =>
      (endOfLocalDay(d, tz).getTime() - startOfLocalDay(d, tz).getTime()) / 3_600_000;
    expect(hours('2026-10-04', 'Australia/Sydney')).toBe(23);
    expect(hours('2026-04-05', 'Australia/Sydney')).toBe(25);
    expect(hours('2026-10-04', 'Australia/Brisbane')).toBe(24);
  });
});

describe('local dates', () => {
  it('validates real calendar dates', () => {
    expect(isLocalDate('2028-02-29')).toBe(true);
    expect(isLocalDate('2026-02-29')).toBe(false);
    expect(isLocalDate('2026-1-1')).toBe(false);
  });

  it('adds days without drifting across daylight saving', () => {
    expect(addDays('2026-10-03', 1)).toBe('2026-10-04');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });
});

describe('business days', () => {
  it('skips weekends and the holidays it is given', () => {
    // Fri 2 Oct 2026 + 1 business day = Mon 5 Oct, unless Mon 5 Oct is a holiday (Labour Day NSW).
    expect(addBusinessDays('2026-10-02', 1)).toBe('2026-10-05');
    expect(addBusinessDays('2026-10-02', 1, { holidays: new Set(['2026-10-05']) })).toBe(
      '2026-10-06',
    );
    expect(addBusinessDays('2026-10-05', 10)).toBe('2026-10-19');
    expect(addBusinessDays('2026-10-05', -1)).toBe('2026-10-02');
  });
});
