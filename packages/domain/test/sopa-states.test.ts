import { describe, expect, it } from 'vitest';
import { SOPA_RULES, computeDeadlines, noScheduleAdjudication, type SopaState } from '../src';

// Expected values are Grace's compliance/02 §1, §3 and §4. Holidays: national days only for the smaller states.
const national = new Set([
  '2026-01-01',
  '2026-01-26',
  '2026-12-25',
  '2026-12-28',
  '2027-01-01',
  '2027-01-26',
]);
const nsw = new Set([...national, '2026-10-05']);
const qld = new Set(national);
const rule = (state: SopaState) => SOPA_RULES.find((r) => r.state === state)!;

describe('other states (compliance/02 §4)', () => {
  const run = (
    state: SopaState,
    servedAt: string,
    timeZone: string,
    o: { kind?: 'head' | 'subcontract'; residentialOwner?: boolean } = {},
  ) => {
    const r = computeDeadlines({
      rule: rule(state),
      servedAt: new Date(servedAt),
      timeZone,
      contractKind: o.kind ?? 'head',
      holidays: national,
      statesAct: true,
      ...(o.residentialOwner ? { residentialOwner: true } : {}),
    });
    if (!r.valid) throw new Error('expected valid');
    return r;
  };

  it('W1: WA, 22 Dec to 10 Jan excluded; caps 20 head / 25 sub', () => {
    const head = run('WA', '2026-12-10T02:00:00Z', 'Australia/Perth');
    expect(head.scheduleDueOn).toBe('2027-01-20');
    expect(head.paymentDueOn).toBe('2027-01-28');
    expect(
      run('WA', '2026-12-10T02:00:00Z', 'Australia/Perth', { kind: 'subcontract' }).paymentDueOn,
    ).toBe('2027-02-04');
  });

  it('S1: SA schedule 15 BD, no payment cap so a long contract term stands', () => {
    expect(run('SA', '2026-12-17T02:00:00Z', 'Australia/Adelaide').scheduleDueOn).toBe(
      '2027-01-15',
    );
    const long = computeDeadlines({
      rule: rule('SA'),
      servedAt: new Date('2026-12-17T02:00:00Z'),
      timeZone: 'Australia/Adelaide',
      contractKind: 'head',
      contractPaymentDays: 40,
      holidays: national,
      statesAct: true,
    });
    expect(long.valid && long.paymentReadDown).toBe(false);
  });

  it('T1: TAS 10 BD, 20 BD for a residential owner', () => {
    expect(run('TAS', '2026-12-17T02:00:00Z', 'Australia/Hobart').scheduleDueOn).toBe('2027-01-08');
    expect(
      run('TAS', '2026-12-17T02:00:00Z', 'Australia/Hobart', { residentialOwner: true })
        .scheduleDueOn,
    ).toBe('2027-01-22');
  });

  it('A1: ACT schedule 10 BD, payment 15 BD', () => {
    const r = run('ACT', '2026-12-17T02:00:00Z', 'Australia/Sydney');
    expect(r.scheduleDueOn).toBe('2027-01-08');
    expect(r.paymentDueOn).toBe('2027-01-15');
  });

  it('flags a missing Act statement in WA, SA, TAS and ACT', () => {
    for (const state of ['WA', 'SA', 'TAS', 'ACT'] as const) {
      const r = computeDeadlines({
        rule: rule(state),
        servedAt: new Date('2026-12-10T02:00:00Z'),
        timeZone: 'Australia/Sydney',
        contractKind: 'head',
        holidays: national,
        statesAct: false,
      });
      expect(r.valid).toBe(false);
    }
  });
});

describe('adjudication with no schedule', () => {
  it('N13: NSW notice path', () => {
    const r = noScheduleAdjudication({
      rule: rule('NSW'),
      holidays: nsw,
      paymentDueOn: '2026-10-26',
      scheduleDueOn: '2026-10-19',
      noticeServedOn: '2026-10-27',
    });
    expect(r).toEqual({
      kind: 'notice',
      noticeBy: '2026-11-23',
      respondentBy: '2026-11-03',
      applyBy: '2026-11-17',
    });
  });

  it('NSW before the notice is served: only the notice deadline is known', () => {
    const r = noScheduleAdjudication({
      rule: rule('NSW'),
      holidays: nsw,
      paymentDueOn: '2026-10-26',
      scheduleDueOn: '2026-10-19',
    });
    expect(r).toEqual({
      kind: 'notice',
      noticeBy: '2026-11-23',
      respondentBy: null,
      applyBy: null,
    });
  });

  it('Q11: QLD runs 30 BD from the later of due date and last day for schedule', () => {
    const r = noScheduleAdjudication({
      rule: rule('QLD'),
      holidays: qld,
      paymentDueOn: '2027-01-22',
      scheduleDueOn: '2027-02-01',
    });
    expect(r).toEqual({ kind: 'direct', applyBy: '2027-03-15' });
  });
});
