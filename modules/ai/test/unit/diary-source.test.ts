import { describe, expect, it } from 'vitest';
import {
  diaryRevisionId,
  diaryText,
  diaryTitle,
  longDate,
  type DiarySource,
} from '../../src/domain/diary-source';

const line = (kind: string, text: string, extra: Partial<DiarySource['lines'][number]> = {}) => ({
  id: `${kind}-${text}`,
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

const DAY: DiarySource = {
  entryId: 'e1',
  date: '2026-10-12',
  timeZone: 'Australia/Brisbane',
  status: 'signed_off',
  version: 3,
  weather: { summary: 'Showers in the morning', minC: 14, maxC: 22, rainMm: 12.5, lostHours: 2 },
  siteConditions: 'Wet underfoot after overnight rain',
  notes: 'Level 3 pour delayed to 10am.',
  lines: [
    line('labour', 'Formwork', { company: 'Formco', headcount: 6, hours: 45.5 }),
    line('labour', 'Electrical', { company: 'Sparky', headcount: 2, hours: 16 }),
    line('plant', 'Franna crane x1', { company: 'Cranes R Us', hours: 8 }),
    line('delivery', 'Reo for L3 slab, docket 4471', { company: 'Steelco', at: '07:40' }),
    line('delay', 'Rain stopped the pour', { delayCause: 'weather', hours: 2 }),
    line('stand_down', 'Inclement weather under the site agreement', { at: '07:00' }),
    line('visitor', 'J. Inspector - footing inspection', { company: 'Council', at: '11:00' }),
    line('inspection', 'Engineer passed L3 reo', { at: '13:15' }),
  ],
};

describe('longDate', () => {
  it('spells out the weekday and month for a site-local date', () => {
    expect(longDate('2026-10-12')).toBe('Monday 12 October 2026');
    expect(longDate('2027-02-01')).toBe('Monday 1 February 2027');
    expect(diaryTitle('2026-12-25')).toBe('Site diary Friday 25 December 2026');
  });
});

describe('diaryText', () => {
  it('puts the date and status first, then weather, notes, labour totals and each kind of line', () => {
    expect(diaryText(DAY)).toBe(
      [
        'Site diary Monday 12 October 2026 (signed off)',
        'Weather: Showers in the morning; temperature 14 to 22 °C; rain 12.5 mm; 2 hours lost to weather',
        'Site conditions:\nWet underfoot after overnight rain',
        'Notes:\nLevel 3 pour delayed to 10am.',
        'Labour on site: 8 people, 61.5 hours, 2 companies on site',
        'Labour:\n- Formco, 6 people, 45.5 hours | Formwork\n- Sparky, 2 people, 16 hours | Electrical',
        'Plant:\n- Cranes R Us, 8 hours | Franna crane x1',
        'Deliveries:\n- Steelco, at 07:40 | Reo for L3 slab, docket 4471',
        'Delays:\n- 2 hours, cause: weather | Rain stopped the pour',
        'Stand-downs:\n- at 07:00 | Inclement weather under the site agreement',
        'Visitors:\n- Council, at 11:00 | J. Inspector - footing inspection',
        'Inspection:\n- at 13:15 | Engineer passed L3 reo',
      ].join('\n\n'),
    );
  });

  it('leaves out what the day does not have', () => {
    expect(
      diaryText({
        ...DAY,
        status: 'submitted',
        weather: null,
        siteConditions: null,
        notes: '',
        lines: [],
      }),
    ).toBe('Site diary Monday 12 October 2026 (submitted)');
  });
});

describe('diaryRevisionId', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/;

  it('is a UUID that stays the same while the text does', () => {
    expect(diaryRevisionId(DAY)).toMatch(uuid);
    expect(diaryRevisionId({ ...DAY })).toBe(diaryRevisionId(DAY));
    // The entry's version is not part of the text: it moves on edits that change nothing Ask can see.
    expect(diaryRevisionId({ ...DAY, version: 9 })).toBe(diaryRevisionId(DAY));
  });

  it('changes when the status, a note or a line changes', () => {
    const id = diaryRevisionId(DAY);
    for (const change of [
      { status: 'submitted' },
      { notes: 'Level 3 pour delayed to 11am.' },
      { lines: DAY.lines.slice(1) },
      {
        lines: DAY.lines.map((l) => (l.kind === 'labour' ? { ...l, headcount: 7 } : l)),
      },
    ] satisfies Partial<DiarySource>[])
      expect(diaryRevisionId({ ...DAY, ...change }), JSON.stringify(change)).not.toBe(id);
  });

  it('differs between days with the same words', () => {
    expect(diaryRevisionId({ ...DAY, entryId: 'e2' })).not.toBe(diaryRevisionId(DAY));
  });
});
