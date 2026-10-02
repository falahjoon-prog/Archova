import { describe, expect, it } from 'vitest';
import {
  TOTALS_SOURCE,
  WEATHER_SOURCE,
  diaryFacts,
  reviewDiarySummary,
  weekdayOf,
  type DiaryDayForSummary,
} from '../../src/domain/diary-summary';

const day: DiaryDayForSummary = {
  entryId: 'entry-1',
  date: '2026-10-06',
  timeZone: 'Australia/Sydney',
  status: 'draft',
  version: 3,
  weather: { summary: 'Heavy rain from 10am', minC: 9, maxC: 15, rainMm: 32, lostHours: 5.5 },
  lines: [
    {
      id: 'lab-1',
      kind: 'labour',
      text: 'L4 forms',
      company: 'Harbour Formwork',
      headcount: 8,
      hours: 20,
      delayCause: null,
      at: null,
      photoCaptions: [],
    },
    {
      id: 'lab-2',
      kind: 'labour',
      text: '',
      company: 'Coastal Steel Fixing',
      headcount: 5,
      hours: 12.5,
      delayCause: null,
      at: null,
      photoCaptions: [],
    },
    {
      id: 'del-1',
      kind: 'delay',
      text: 'Pour postponed, rain',
      company: null,
      headcount: null,
      hours: 5.5,
      delayCause: 'weather',
      at: '10:00',
      photoCaptions: ['Ponding on L4 deck'],
    },
  ],
};

describe('diary summary facts (F4)', () => {
  it('numbers the lines, spells out their fields, and adds weather and labour totals', () => {
    const built = diaryFacts(day);
    expect(built.facts).toEqual([
      {
        id: 'w',
        kind: 'weather',
        text: 'Heavy rain from 10am; temperature 9 to 15 °C; rain 32 mm; 5.5 hours lost to weather',
      },
      { id: 't', kind: 'totals', text: '13 people, 32.5 hours, 2 companies on site' },
      { id: 'l1', kind: 'labour', text: 'Harbour Formwork, 8 people, 20 hours | L4 forms' },
      { id: 'l2', kind: 'labour', text: 'Coastal Steel Fixing, 5 people, 12.5 hours' },
      {
        id: 'l3',
        kind: 'delay',
        text: '5.5 hours, cause: weather, at 10:00 | Pour postponed, rain (photos: Ponding on L4 deck)',
      },
    ]);
    expect(built.sources.get('w')).toBe(WEATHER_SOURCE);
    expect(built.sources.get('t')).toBe(TOTALS_SOURCE);
    expect(built.sources.get('l3')).toEqual({ kind: 'delay', id: 'del-1' });
    expect(built.delayIds).toEqual(['l3']);
    expect(weekdayOf(day.date)).toBe('Tuesday');
    expect(diaryFacts({ ...day, weather: null, lines: [] }).facts).toEqual([]);
  });

  it('drops sentences with invented numbers or no valid source, and lists delays left out', () => {
    const built = diaryFacts(day);
    const reviewed = reviewDiarySummary(
      {
        sentences: [
          { text: 'Heavy rain fell, with 32 mm recorded.', sources: ['w'] },
          { text: '13 people worked 32.5 hours.', sources: ['t'] },
          // 40 isn't in the sources: invented.
          { text: 'Harbour Formwork had 40 people on L4.', sources: ['l1'] },
          { text: 'Work went well.', sources: ['l9'] },
        ],
        possibleDelay: { flagged: false, cause: null, sources: [] },
      },
      built,
      day,
    );
    expect(reviewed.sentences).toEqual([
      { text: 'Heavy rain fell, with 32 mm recorded.', sources: [WEATHER_SOURCE] },
      { text: '13 people worked 32.5 hours.', sources: [TOTALS_SOURCE] },
    ]);
    expect(reviewed.dropped).toBe(2);
    expect(reviewed.unmentionedDelays).toEqual([{ kind: 'delay', id: 'del-1' }]);
    // A delay line always raises the flag, with the cause the site recorded.
    expect(reviewed.possibleDelay).toEqual({
      flagged: true,
      cause: 'weather',
      sources: [{ kind: 'delay', id: 'del-1' }],
    });
  });

  it('keeps a flag the model raised from a note only when it cites something real', () => {
    const quiet = { ...day, weather: null, lines: day.lines.slice(0, 1) };
    const built = diaryFacts(quiet);
    const out = (sources: string[]) => ({
      sentences: [],
      possibleDelay: { flagged: true, cause: 'other' as const, sources },
    });
    expect(reviewDiarySummary(out(['l1']), built, quiet).possibleDelay).toEqual({
      flagged: true,
      cause: 'other',
      sources: [{ kind: 'labour', id: 'lab-1' }],
    });
    expect(reviewDiarySummary(out(['l7']), built, quiet).possibleDelay).toEqual({
      flagged: false,
      cause: null,
      sources: [],
    });
  });
});
