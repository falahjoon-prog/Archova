import { describe, expect, it } from 'vitest';
import {
  filterRows,
  rfiRows,
  sortRows,
  totals,
  type RfiImpactInput,
} from '../../src/domain/register';

const TZ = 'Australia/Brisbane';
const rfi = (over: Partial<RfiImpactInput>): RfiImpactInput => ({
  id: 'x',
  number: 14,
  subject: 'Slab edge',
  status: 'open',
  dueDate: null,
  openedAt: null,
  answeredAt: null,
  scheduleImpactDays: null,
  ...over,
});

describe('rfiRows', () => {
  it('gives a row for the recorded schedule impact, dated the day it was sent in the project zone', () => {
    // 22:00 UTC on the 9th is 08:00 on the 10th in Brisbane.
    const rows = rfiRows(
      rfi({ scheduleImpactDays: 4, openedAt: new Date('2027-03-09T22:00:00Z') }),
      'rfi_1',
      '2027-03-20',
      TZ,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'rfi_schedule_impact',
      date: '2027-03-10',
      days: 4,
      title: 'RFI-014 Slab edge',
    });
  });

  it('counts days late from the due date to the answer, or to today while still open', () => {
    const answered = rfiRows(
      rfi({
        status: 'answered',
        dueDate: '2027-03-10',
        answeredAt: new Date('2027-03-14T02:00:00Z'),
      }),
      'rfi_1',
      '2027-03-20',
      TZ,
    );
    expect(answered).toMatchObject([{ kind: 'rfi_late_answer', date: '2027-03-10', days: 4 }]);
    const open = rfiRows(rfi({ dueDate: '2027-03-15' }), 'rfi_2', '2027-03-20', TZ);
    expect(open).toMatchObject([{ days: 5 }]);
  });

  it('gives nothing for an answer on time, a future due date or a zero impact', () => {
    expect(
      rfiRows(
        rfi({
          status: 'answered',
          dueDate: '2027-03-10',
          answeredAt: new Date('2027-03-09T20:00:00Z'),
        }),
        'a',
        '2027-03-20',
        TZ,
      ),
    ).toEqual([]);
    expect(rfiRows(rfi({ dueDate: '2027-03-25' }), 'b', '2027-03-20', TZ)).toEqual([]);
    expect(rfiRows(rfi({ scheduleImpactDays: 0 }), 'c', '2027-03-20', TZ)).toEqual([]);
  });

  it('gives two rows when an RFI both has an impact and was late', () => {
    expect(
      rfiRows(rfi({ scheduleImpactDays: 2, dueDate: '2027-03-10' }), 'd', '2027-03-20', TZ).map(
        (r) => r.kind,
      ),
    ).toEqual(['rfi_schedule_impact', 'rfi_late_answer']);
  });
});

describe('filter, sort and totals', () => {
  const a = rfiRows(rfi({ scheduleImpactDays: 3, dueDate: '2027-03-01' }), 'a', '2027-03-20', TZ);
  const rows = [
    ...a,
    {
      ...a[0]!,
      id: 'diary:1',
      source: 'diary' as const,
      kind: 'diary_delay' as const,
      cause: 'subcontractor' as const,
      date: '2027-03-18',
      days: null,
      hours: 2.5,
      possibleEot: false,
    },
  ];
  it('filters by cause, source, EOT flag and dates', () => {
    expect(filterRows(rows, { cause: 'subcontractor' })).toHaveLength(1);
    expect(filterRows(rows, { source: 'rfi' })).toHaveLength(2);
    expect(filterRows(rows, { eotOnly: true })).toHaveLength(2);
    expect(filterRows(rows, { from: '2027-03-18' })).toHaveLength(1);
  });
  it('sorts newest first and adds up hours and days', () => {
    expect(sortRows(rows)[0]!.id).toBe('diary:1');
    expect(totals(rows)).toEqual({ rows: 3, possibleEotRows: 2, diaryHours: 2.5, rfiDays: 3 + 19 });
  });
});
