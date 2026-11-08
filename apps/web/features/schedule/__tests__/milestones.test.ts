import { describe, expect, it } from 'vitest';
import { milestones } from '../lib/milestones';
import type { KeyDates } from '../data/api';

const base: KeyDates = {
  projectId: 'p',
  possessionDate: null,
  pcTarget: null,
  pcActual: null,
  dlpEnd: null,
  ldRatePerDay: null,
  currency: 'AUD',
  sections: [],
  daysToPc: null,
  daysToDlpEnd: null,
  version: 1,
  updatedAt: null,
};

describe('milestones', () => {
  it('is empty with no dates', () => {
    expect(milestones(base, '2026-11-08')).toEqual([]);
  });

  it('orders by date, marks done, late and next, and puts the actual date in place of the target', () => {
    const r = milestones(
      {
        ...base,
        possessionDate: '2026-01-05',
        sections: [
          { id: 's1', name: 'Stage 1', targetDate: '2026-10-01', actualDate: null },
          { id: 's2', name: 'Stage 2', targetDate: '2026-12-01', actualDate: null },
        ],
        pcTarget: '2027-02-01',
        dlpEnd: '2028-02-01',
      },
      '2026-11-08',
    );
    expect(r.map((m) => [m.id, m.state, m.note])).toEqual([
      ['possession', 'done', 'done'],
      ['section-s1', 'late', '38 days late'],
      ['section-s2', 'next', 'in 23 days'],
      ['pc', 'later', 'in 85 days'],
      ['dlp', 'later', 'in 450 days'],
    ]);
  });

  it('reads an early or late finish against its target', () => {
    const r = milestones(
      { ...base, pcTarget: '2026-10-10', pcActual: '2026-10-07', dlpEnd: '2027-10-07' },
      '2026-11-08',
    );
    expect(r[0]).toMatchObject({
      id: 'pc',
      date: '2026-10-07',
      state: 'done',
      note: 'done 3 days early',
    });
    expect(r[1]).toMatchObject({ id: 'dlp', state: 'next' });
  });

  it('never calls the end of defects liability late', () => {
    const r = milestones({ ...base, pcTarget: '2026-01-01', dlpEnd: '2026-02-01' }, '2026-11-08');
    expect(r[1]).toMatchObject({ id: 'dlp', state: 'next', note: 'ended' });
  });
});
