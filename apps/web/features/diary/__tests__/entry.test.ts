import { companyName } from '@/shared/mocks/directory';
import { describe, expect, it } from 'vitest';
import { emptyContent } from '../data/source';
import {
  copyLabour,
  dayStrip,
  diffContent,
  eotByDefault,
  isLateSubmission,
  labourTotals,
  submitProblems,
} from '../lib/entry';

describe('diary rules', () => {
  it('ticks possible EOT by default for weather, client, design and authority (DIA-AC4)', () => {
    expect(eotByDefault('weather')).toBe(true);
    expect(eotByDefault('authority')).toBe(true);
    expect(eotByDefault('subcontractor')).toBe(false);
    expect(eotByDefault('industrial')).toBe(false);
  });

  it('copies yesterday’s companies without headcount or hours (DIA-AC3)', () => {
    let i = 0;
    const copied = copyLabour(
      [{ id: 'a', companyId: 'cmp_form', trade: 'Formwork', headcount: 6, hours: 54 }],
      () => `n${++i}`,
    );
    expect(copied).toEqual([
      { id: 'n1', companyId: 'cmp_form', trade: 'Formwork', headcount: null, hours: null },
    ]);
  });

  it('marks a submission late after 10am the next day, project time (DIA-AC7)', () => {
    // 10:00 AEST on 2 Oct is 00:00 UTC.
    expect(
      isLateSubmission('2026-10-01', new Date('2026-10-01T23:59:00Z'), 'Australia/Sydney'),
    ).toBe(false);
    expect(
      isLateSubmission('2026-10-01', new Date('2026-10-02T00:01:00Z'), 'Australia/Sydney'),
    ).toBe(true);
    // Perth is UTC+8: 10:00 AWST is 02:00 UTC.
    expect(
      isLateSubmission('2026-10-01', new Date('2026-10-02T01:00:00Z'), 'Australia/Perth'),
    ).toBe(false);
  });

  it('totals labour and blocks submit on blank headcount or incomplete delays', () => {
    const c = {
      ...emptyContent(),
      labour: [
        { id: 'a', companyId: 'cmp_form', trade: 'Formwork', headcount: 6, hours: 54 },
        { id: 'b', companyId: 'cmp_elec', trade: 'Electrical', headcount: null, hours: null },
      ],
      delays: [
        {
          id: 'd',
          type: 'weather' as const,
          hours: null,
          description: '',
          affectedCompanyIds: [],
          isEotCandidate: true,
        },
      ],
    };
    expect(labourTotals(c)).toEqual({ headcount: 6, hours: 54 });
    expect(submitProblems(c, companyName)).toEqual([
      'Delay 1 needs hours and a description.',
      'Add a headcount for Brightwire Electrical, or remove the line.',
    ]);
  });

  it('asks for a reason when sign-in numbers are changed', () => {
    const line = {
      id: 'a',
      companyId: 'cmp_elec',
      trade: '',
      headcount: 4,
      hours: 32,
      signIn: { headcount: 4, hours: 32 },
      editReason: '',
    };
    const c = (l: typeof line) => ({ ...emptyContent(), labour: [l] });
    expect(submitProblems(c(line), companyName)).toEqual([]);
    expect(submitProblems(c({ ...line, headcount: 3 }), companyName)).toEqual([
      "Say why Brightwire Electrical's numbers differ from site sign-in.",
    ]);
    expect(
      submitProblems(
        c({ ...line, headcount: 3, editReason: 'Apprentice left early' }),
        companyName,
      ),
    ).toEqual([]);
  });

  it('describes amendments line by line', () => {
    const before = {
      ...emptyContent(),
      labour: [{ id: 'a', companyId: 'cmp_elec', trade: 'Electrical', headcount: 3, hours: 24 }],
    };
    const after = {
      ...before,
      notes: 'Late finish',
      labour: [{ ...before.labour[0]!, headcount: 4 }],
    };
    expect(diffContent(before, after, companyName)).toEqual([
      { field: 'Notes', before: 'blank', after: 'Late finish' },
      { field: 'Labour · Brightwire Electrical headcount', before: '3', after: '4' },
    ]);
  });

  it('marks business days with no entry as missed and skips weekends', () => {
    const strip = dayStrip(
      [{ date: '2026-10-01', status: 'submitted', late: false, amendments: [] }],
      '2026-09-25',
      '2026-10-01',
    );
    expect(strip.map((d) => `${d.date}:${d.status}`)).toEqual([
      '2026-10-01:submitted',
      '2026-09-30:missing',
      '2026-09-29:missing',
      '2026-09-28:missing',
      '2026-09-25:missing',
    ]);
  });
});
