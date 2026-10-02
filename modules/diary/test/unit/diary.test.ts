import { describe, expect, it } from 'vitest';
import {
  copyLabour,
  defaultEotCandidate,
  diffChanges,
  isLateSubmit,
  labourTotals,
  lateCutoff,
  recordTime,
} from '../../src/domain/diary';

describe('lateCutoff', () => {
  it('is 10am the next day in the project zone', () => {
    expect(lateCutoff('2026-10-01', 'Australia/Brisbane').toISOString()).toBe(
      '2026-10-02T00:00:00.000Z',
    );
  });

  it('follows daylight saving in Sydney', () => {
    // 4 Oct 2026 is the first day of AEDT (+11).
    expect(lateCutoff('2026-10-04', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-04T23:00:00.000Z',
    );
    expect(lateCutoff('2026-10-02', 'Australia/Sydney').toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
  });

  it('marks a submit after the cut-off as late, and one before it as on time', () => {
    const tz = 'Australia/Perth';
    expect(isLateSubmit(new Date('2026-10-02T01:59:00Z'), '2026-10-01', tz)).toBe(false);
    expect(isLateSubmit(new Date('2026-10-02T02:01:00Z'), '2026-10-01', tz)).toBe(true);
    expect(isLateSubmit(new Date('2026-10-02T00:30:00Z'), '2026-10-01', tz, '08:00')).toBe(true);
  });
});

describe('defaultEotCandidate', () => {
  it('ticks weather, client, design and authority delays only', () => {
    expect(defaultEotCandidate('weather')).toBe(true);
    expect(defaultEotCandidate('client')).toBe(true);
    expect(defaultEotCandidate('design')).toBe(true);
    expect(defaultEotCandidate('authority')).toBe(true);
    expect(defaultEotCandidate('subcontractor')).toBe(false);
    expect(defaultEotCandidate('industrial')).toBe(false);
    expect(defaultEotCandidate('other')).toBe(false);
  });
});

describe('recordTime', () => {
  const received = new Date('2026-10-02T08:00:00Z');
  it('takes the device time when it is in the past', () => {
    const client = new Date('2026-10-01T07:00:00Z');
    expect(recordTime(client, received)).toBe(client);
  });
  it('ignores a device clock ahead of the server', () => {
    expect(recordTime(new Date('2026-10-02T09:00:00Z'), received)).toBe(received);
    expect(recordTime(undefined, received)).toBe(received);
  });
});

describe('diffChanges', () => {
  it('records only the fields that change, as [before, after]', () => {
    expect(
      diffChanges(
        { headcount: 4, hours: 32, trade: 'Formwork' },
        { headcount: 5, hours: 32, trade: undefined, notes: 'late start' },
      ),
    ).toEqual({ headcount: [4, 5], notes: [null, 'late start'] });
  });
  it('compares arrays and objects by value', () => {
    expect(diffChanges({ ids: ['a', 'b'] }, { ids: ['a', 'b'] })).toEqual({});
    expect(diffChanges({ w: { rain: 2 } }, { w: { rain: 3 } })).toEqual({
      w: [{ rain: 2 }, { rain: 3 }],
    });
  });
});

describe('labour', () => {
  it('totals companies, headcount and hours, counting blanks as zero', () => {
    expect(
      labourTotals([
        { companyId: 'a', headcount: 4, hours: 30.5 },
        { companyId: 'a', headcount: null, hours: null },
        { companyId: 'b', headcount: 2, hours: 16.25 },
      ]),
    ).toEqual({ companies: 2, headcount: 6, hours: 46.75 });
  });

  it('copies one blank line per company and trade', () => {
    expect(
      copyLabour([
        { companyId: 'a', trade: 'Formwork', headcount: 4 },
        { companyId: 'a', trade: 'Formwork', headcount: 2 },
        { companyId: 'a', trade: 'Steel fixing', headcount: 3 },
        { companyId: 'b', trade: null, headcount: 1 },
      ]),
    ).toEqual([
      { companyId: 'a', trade: 'Formwork' },
      { companyId: 'a', trade: 'Steel fixing' },
      { companyId: 'b', trade: null },
    ]);
  });
});
