import { describe, expect, it } from 'vitest';
import {
  SOPA_RULES,
  adjudicationDeadline,
  computeDeadlines,
  ruleInForce,
  type ContractKind,
  type SopaState,
} from '../src';

// Expected values are Grace's compliance/02 table; holidays are its §5. Any change needs her approval on the PR.
const national = [
  '2026-01-01',
  '2026-01-26',
  '2026-12-25',
  '2026-12-28',
  '2027-01-01',
  '2027-01-26',
];
const easter = ['2026-04-03', '2026-04-04', '2026-04-06'];
const HOLIDAYS: Record<string, string[]> = {
  NSW: [...national, ...easter, '2026-06-08', '2026-10-05'],
  VIC: [...national, ...easter, '2026-06-08', '2026-03-09', '2026-11-03'],
  QLD: [...national, ...easter, '2026-05-04', '2026-08-12', '2026-10-05'],
};
const ZONE: Record<string, string> = {
  NSW: 'Australia/Sydney',
  VIC: 'Australia/Melbourne',
  QLD: 'Australia/Brisbane',
};
const rule = (state: SopaState) => SOPA_RULES.find((r) => r.state === state)!;

interface Row {
  id: string;
  state: SopaState;
  servedAt: string;
  kind?: ContractKind;
  contractPay?: number;
  contractSchedule?: number;
  holidays?: string[];
  sched: string;
  payHead?: string;
  paySub?: string;
}

// Served times are local wall-clock in the state's zone, written as UTC instants.
const rows: Row[] = [
  {
    id: 'N1',
    state: 'NSW',
    servedAt: '2026-10-14T00:00:00Z',
    kind: 'head',
    contractPay: 30,
    sched: '2026-10-28',
    payHead: '2026-11-04',
  },
  {
    id: 'N2',
    state: 'NSW',
    servedAt: '2026-10-14T00:00:00Z',
    kind: 'subcontract',
    contractPay: 30,
    sched: '2026-10-28',
    paySub: '2026-11-11',
  },
  {
    id: 'N3',
    state: 'NSW',
    servedAt: '2026-10-02T07:45:00Z',
    kind: 'head',
    sched: '2026-10-19',
    payHead: '2026-10-26',
  },
  {
    id: 'N4',
    state: 'NSW',
    servedAt: '2026-10-02T23:00:00Z',
    kind: 'head',
    sched: '2026-10-19',
    payHead: '2026-10-26',
  },
  { id: 'N5', state: 'NSW', servedAt: '2026-12-15T00:00:00Z', kind: 'head', sched: '2027-01-06' },
  { id: 'N7', state: 'NSW', servedAt: '2026-05-29T00:00:00Z', kind: 'head', sched: '2026-06-15' },
  { id: 'N8', state: 'NSW', servedAt: '2026-03-26T00:00:00Z', kind: 'head', sched: '2026-04-13' },
  {
    id: 'N9',
    state: 'NSW',
    servedAt: '2026-10-14T00:00:00Z',
    kind: 'subcontract',
    contractSchedule: 5,
    sched: '2026-10-21',
  },
  // 13:30Z is 00:30 on 15 Oct in Sydney (UTC+11): a UTC-date bug gives 28 Oct.
  {
    id: 'N10',
    state: 'NSW',
    servedAt: '2026-10-14T13:30:00Z',
    kind: 'head',
    sched: '2026-10-29',
    payHead: '2026-11-05',
  },
  {
    id: 'V1',
    state: 'VIC',
    servedAt: '2026-10-27T00:00:00Z',
    kind: 'subcontract',
    contractPay: 30,
    sched: '2026-11-11',
    paySub: '2026-11-25',
  },
  {
    id: 'V3',
    state: 'VIC',
    servedAt: '2026-12-15T00:00:00Z',
    kind: 'subcontract',
    sched: '2027-01-18',
  },
  {
    id: 'V4',
    state: 'VIC',
    servedAt: '2026-12-21T00:00:00Z',
    kind: 'subcontract',
    sched: '2027-01-22',
  },
  {
    id: 'Q1',
    state: 'QLD',
    servedAt: '2026-09-30T00:00:00Z',
    kind: 'subcontract',
    contractPay: 30,
    sched: '2026-10-22',
    paySub: '2026-11-05',
  },
  {
    id: 'Q2',
    state: 'QLD',
    servedAt: '2026-09-30T00:00:00Z',
    kind: 'head',
    contractPay: 30,
    sched: '2026-10-22',
    payHead: '2026-10-22',
  },
  {
    id: 'Q3',
    state: 'QLD',
    servedAt: '2026-08-05T00:00:00Z',
    kind: 'subcontract',
    sched: '2026-08-27',
    paySub: '2026-08-20',
  },
  // Toowoomba: the Ekka holiday does not apply.
  {
    id: 'Q4',
    state: 'QLD',
    servedAt: '2026-08-05T00:00:00Z',
    kind: 'subcontract',
    holidays: [...HOLIDAYS.QLD!.filter((d) => d !== '2026-08-12')],
    sched: '2026-08-26',
    paySub: '2026-08-19',
  },
  {
    id: 'Q5',
    state: 'QLD',
    servedAt: '2026-12-10T00:00:00Z',
    kind: 'subcontract',
    contractPay: 30,
    sched: '2027-01-20',
    paySub: '2027-02-04',
  },
  {
    id: 'Q6',
    state: 'QLD',
    servedAt: '2026-12-22T00:00:00Z',
    kind: 'subcontract',
    contractPay: 30,
    sched: '2027-02-01',
    paySub: '2027-02-15',
  },
  // 13:30Z is 23:30 on 14 Oct in Brisbane (UTC+10, no daylight saving): same instant as N10, a different day.
  {
    id: 'Q8',
    state: 'QLD',
    servedAt: '2026-10-14T13:30:00Z',
    kind: 'subcontract',
    sched: '2026-11-04',
  },
];

describe('SOPA deadlines (compliance/02)', () => {
  it.each(rows)('$id', (r) => {
    const out = computeDeadlines({
      rule: rule(r.state),
      servedAt: r.servedAt,
      timeZone: ZONE[r.state]!,
      contractKind: r.kind ?? 'subcontract',
      contractScheduleDays: r.contractSchedule ?? null,
      contractPaymentDays: r.contractPay ?? null,
      holidays: new Set(r.holidays ?? HOLIDAYS[r.state]),
      statesAct: true,
    });
    if (!out.valid) throw new Error('claim should be valid');
    expect(out.scheduleDueOn).toBe(r.sched);
    if (r.payHead) expect(out.paymentDueOn).toBe(r.payHead);
    if (r.paySub) expect(out.paymentDueOn).toBe(r.paySub);
  });

  it('serves on the local day, not the UTC day, and not the next day after 5pm (N3, N4)', () => {
    const at = (iso: string) =>
      computeDeadlines({
        rule: rule('NSW'),
        servedAt: iso,
        timeZone: 'Australia/Sydney',
        contractKind: 'head',
        holidays: new Set(HOLIDAYS.NSW),
        statesAct: true,
      });
    expect(at('2026-10-02T07:45:00Z')).toMatchObject({ servedOn: '2026-10-02' });
    expect(at('2026-10-14T13:30:00Z')).toMatchObject({ servedOn: '2026-10-15' });
  });

  it('flags a claim that does not say it is made under the Act in NSW and VIC, not QLD (N14, V7, Q7)', () => {
    const base = {
      servedAt: '2026-10-14T00:00:00Z',
      contractKind: 'subcontract' as const,
      holidays: new Set<string>(),
      statesAct: false,
    };
    expect(
      computeDeadlines({ ...base, rule: rule('NSW'), timeZone: 'Australia/Sydney' }),
    ).toMatchObject({ valid: false, reason: 'act_statement_missing' });
    expect(
      computeDeadlines({ ...base, rule: rule('VIC'), timeZone: 'Australia/Melbourne' }),
    ).toMatchObject({ valid: false });
    expect(
      computeDeadlines({ ...base, rule: rule('QLD'), timeZone: 'Australia/Brisbane' }),
    ).toMatchObject({ valid: true });
  });

  it('says when a payment term was read down to the cap, and when rules are unreviewed (N1)', () => {
    const out = computeDeadlines({
      rule: rule('NSW'),
      servedAt: '2026-10-14T00:00:00Z',
      timeZone: 'Australia/Sydney',
      contractKind: 'head',
      contractPaymentDays: 30,
      holidays: new Set(HOLIDAYS.NSW),
      statesAct: true,
    });
    expect(out).toMatchObject({
      valid: true,
      paymentReadDown: true,
      supportingStatementRequired: true,
      rulesReviewed: false,
    });
  });

  it('picks the rule row in force on the service date (V10)', () => {
    expect(ruleInForce(SOPA_RULES, 'VIC', '2026-10-27')?.state).toBe('VIC');
    expect(ruleInForce(SOPA_RULES, 'VIC', '2026-04-10')).toBeNull();
  });
});

describe('adjudication deadlines', () => {
  const adj = (state: SopaState, o: { scheduleGivenOn?: string; paymentDueOn?: string }) =>
    adjudicationDeadline({ rule: rule(state), holidays: new Set(HOLIDAYS[state]), ...o });
  it('schedule for less than the claim: N11, V8, Q9', () => {
    expect(adj('NSW', { scheduleGivenOn: '2026-10-28' })).toBe('2026-11-11');
    expect(adj('VIC', { scheduleGivenOn: '2026-11-11' })).toBe('2026-11-25');
    expect(adj('QLD', { scheduleGivenOn: '2026-10-22' })).toBe('2026-12-03');
  });
  it('scheduled amount unpaid: N12, V9, Q10', () => {
    expect(adj('NSW', { paymentDueOn: '2026-11-04' })).toBe('2026-12-02');
    expect(adj('VIC', { paymentDueOn: '2026-11-25' })).toBe('2026-12-09');
    expect(adj('QLD', { paymentDueOn: '2026-10-22' })).toBe('2026-11-19');
  });
});
