import { describe, expect, it } from 'vitest';
import { runChecks, type CheckInput } from '../../src/domain/tmChecks';

const base: CheckInput = {
  workDate: '2026-11-03',
  lines: [
    {
      kind: 'labour',
      description: 'Dan',
      quantity: '8.00',
      unit: 'hr',
      sourceType: 'timesheet_line',
      sourceId: 'ts1',
    },
    {
      kind: 'equipment',
      description: 'Excavator',
      quantity: '4.00',
      unit: 'hr',
      sourceType: 'equipment_log',
      sourceId: 'eq1',
    },
  ],
  signoffs: [{ role: 'contractor', geofenceStatus: 'inside' }],
  day: {
    labour: [{ timesheetLineId: 'ts1', hours: '8.00' }],
    equipment: [{ equipmentLogId: 'eq1', hours: '4.00' }],
  },
  diaryEntryExists: true,
};

const codes = (i: CheckInput) => runChecks(i).map((f) => f.code);

describe('T&M ticket checks', () => {
  it('has nothing to say when everything matches', () => {
    expect(runChecks(base)).toEqual([]);
  });
  it('flags a day with no diary entry', () => {
    expect(codes({ ...base, diaryEntryExists: false })).toEqual(['no_diary_entry']);
  });
  it('flags hours that differ from the timesheet or equipment log by more than a quarter hour', () => {
    const day = {
      labour: [{ timesheetLineId: 'ts1', hours: '7.00' }],
      equipment: [{ equipmentLogId: 'eq1', hours: '3.90' }],
    };
    expect(codes({ ...base, day })).toEqual(['labour_hours_differ']);
    expect(runChecks({ ...base, day })[0]!.line).toBe(1);
  });
  it('notes lines that are not tied to a record, and does not flag them as mismatches', () => {
    const lines = base.lines.map((l) => ({ ...l, sourceType: null, sourceId: null }));
    expect(codes({ ...base, lines })).toEqual([
      'labour_not_from_timesheet',
      'equipment_not_from_log',
    ]);
  });
  it('flags sign-offs recorded off site or unconfirmed, not unknown ones', () => {
    expect(
      codes({
        ...base,
        signoffs: [
          { role: 'contractor', geofenceStatus: 'outside' },
          { role: 'principal_rep', geofenceStatus: 'uncertain' },
          { role: 'x', geofenceStatus: 'unknown' },
        ],
      }),
    ).toEqual(['signed_off_site', 'signed_off_site']);
  });
});
