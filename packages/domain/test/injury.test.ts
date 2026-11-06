import { describe, expect, it } from 'vitest';
import {
  injuryProblems,
  isLostTime,
  isRecordable,
  ratePerMillionHours,
  readInjury,
  summariseInjuries,
  type InjuryRecord,
} from '../src/injury';

const rec = (over: Partial<InjuryRecord> = {}): InjuryRecord => ({
  incidentId: 'i',
  projectId: 'p',
  ref: 'INC-0001',
  occurredAt: '2026-10-01T00:00:00Z',
  localDate: '2026-10-01',
  personName: 'A',
  companyId: null,
  notifiable: false,
  bodyPart: 'hand',
  injuryType: 'laceration',
  harmSource: 'hitting_objects',
  outcome: 'first_aid',
  daysLost: 0,
  ...over,
});

describe('readInjury', () => {
  it('keeps recognised values and drops the rest', () => {
    expect(
      readInjury({
        bodyPart: 'hand',
        injuryType: 'nonsense',
        outcome: 'lost_time',
        daysLost: 3,
        note: 'x',
      }),
    ).toEqual({
      bodyPart: 'hand',
      injuryType: null,
      harmSource: null,
      outcome: 'lost_time',
      daysLost: 3,
    });
    expect(readInjury(null).bodyPart).toBeNull();
  });
});

describe('injuryProblems', () => {
  it('accepts free text keys and valid structured ones', () => {
    expect(
      injuryProblems({ note: 'x', bodyPart: 'knee', outcome: 'lost_time', daysLost: 2 }),
    ).toEqual([]);
  });
  it('flags unknown values and days lost without a lost time outcome', () => {
    const paths = injuryProblems({ bodyPart: 'elbowish', outcome: 'first_aid', daysLost: 2 }).map(
      (p) => p.path,
    );
    expect(paths).toEqual(['injury.bodyPart', 'injury.daysLost']);
    expect(injuryProblems({ outcome: 'lost_time', daysLost: -1 })).toHaveLength(1);
  });
});

describe('rates', () => {
  it('is per million hours to one decimal, and null without hours', () => {
    expect(ratePerMillionHours(2, 500_000)).toBe(4);
    expect(ratePerMillionHours(1, 300_000)).toBe(3.3);
    expect(ratePerMillionHours(1, 0)).toBeNull();
    expect(ratePerMillionHours(1, null)).toBeNull();
  });
  it('counts a fatality as lost time and first aid as not recordable', () => {
    expect(isLostTime({ outcome: 'fatality' })).toBe(true);
    expect(isLostTime({ outcome: 'restricted_work' })).toBe(false);
    expect(isRecordable({ outcome: 'first_aid' })).toBe(false);
    expect(isRecordable({ outcome: 'medical_treatment' })).toBe(true);
  });
});

describe('summariseInjuries', () => {
  it('totals, rates and breakdowns', () => {
    const s = summariseInjuries(
      [
        rec({ outcome: 'lost_time', daysLost: 4, notifiable: true }),
        rec({ outcome: 'medical_treatment', bodyPart: 'knee' }),
        rec({ bodyPart: null, harmSource: null }),
      ],
      1_000_000,
    );
    expect(s).toMatchObject({
      injuries: 3,
      lostTimeInjuries: 1,
      recordableInjuries: 2,
      daysLost: 4,
      notifiable: 1,
      ltifr: 1,
      trifr: 2,
    });
    expect(s.byBodyPart).toEqual([
      { key: 'hand', count: 1 },
      { key: 'knee', count: 1 },
      { key: 'unknown', count: 1 },
    ]);
    expect(s.byOutcome[0]).toEqual({ key: 'first_aid', count: 1 });
  });
  it('has no rates when hours are unknown', () => {
    expect(summariseInjuries([rec()], null)).toMatchObject({ ltifr: null, trifr: null });
  });
});
