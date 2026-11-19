import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  addPeriod,
  canDo,
  clock,
  clocks,
  computeFlags,
  draftEotLetter,
  isRainDay,
  spanDays,
  summariseEvidence,
  weatherText,
  type EotSettings,
  type EvidenceItem,
  type FlagEvent,
} from '../../src/domain/eot';

const S: EotSettings = { ...DEFAULT_SETTINGS, confirmed: true };
const item = (over: Partial<EvidenceItem>): EvidenceItem => ({
  id: 'i',
  kind: 'diary_delay',
  onDate: '2027-03-10',
  label: 'Rain stopped the slab pour',
  detail: null,
  hours: 6,
  days: null,
  rainMm: null,
  ...over,
});
const none = summariseEvidence([]);

describe('addPeriod', () => {
  it('counts calendar days by default', () => {
    expect(addPeriod('2027-03-10', 14, 'calendar')).toBe('2027-03-24');
  });
  it('counts weekdays only on a business-day basis, never later than the contract (holidays are not skipped)', () => {
    // Friday 12 March 2027 + 3 business days = Wednesday 17 March.
    expect(addPeriod('2027-03-12', 3, 'business')).toBe('2027-03-17');
  });
});

describe('clock', () => {
  it('is ok with time to spare, then due_soon at 3 days, due_today, overdue', () => {
    expect(clock('2027-03-20', null, '2027-03-10', false)).toMatchObject({
      state: 'ok',
      daysLeft: 10,
    });
    expect(clock('2027-03-20', null, '2027-03-17', false)).toMatchObject({
      state: 'due_soon',
      daysLeft: 3,
    });
    expect(clock('2027-03-20', null, '2027-03-20', false)).toMatchObject({
      state: 'due_today',
      daysLeft: 0,
    });
    expect(clock('2027-03-20', null, '2027-03-22', false)).toMatchObject({
      state: 'overdue',
      daysLeft: -2,
    });
  });
  it('shows a notice as met on the day, and met late after it, without a countdown', () => {
    expect(clock('2027-03-20', '2027-03-20', '2027-04-01', false)).toMatchObject({
      state: 'met',
      daysLeft: null,
    });
    expect(clock('2027-03-20', '2027-03-21', '2027-04-01', false)).toMatchObject({
      state: 'met_late',
    });
  });
  it('uses a deadline a person set to match a contract amendment, and says so', () => {
    const c = clocks(
      {
        awareOn: '2027-03-01',
        noticeDueOn: '2027-03-05',
        claimDueOn: null,
        noticeSentOn: null,
        claimSentOn: null,
      },
      S,
      '2027-03-02',
    );
    expect(c.notice).toMatchObject({ dueOn: '2027-03-05', overridden: true });
    // 28 calendar days from the day the builder became aware.
    expect(c.claim).toMatchObject({ dueOn: '2027-03-29', overridden: false });
  });
});

describe('status moves', () => {
  it('lets a claim go in without a recorded notice, and only a claimed event be assessed', () => {
    expect(canDo('draft', 'submit_claim')).toBe(true);
    expect(canDo('draft', 'record_assessment')).toBe(false);
    expect(canDo('claimed', 'record_assessment')).toBe(true);
    expect(canDo('closed', 'give_notice')).toBe(false);
    expect(canDo('withdrawn', 'reopen')).toBe(true);
  });
});

describe('weather', () => {
  it('calls a day a rain day on the threshold or when the site logged weather delay', () => {
    expect(isRainDay(10, 0, 10)).toBe(true);
    expect(isRainDay(9.9, 0, 10)).toBe(false);
    expect(isRainDay(null, 2, 10)).toBe(true);
    expect(isRainDay(null, 0, 10)).toBe(false);
  });
  it('describes the readings it has and says when it has none', () => {
    expect(
      weatherText({
        rainfallMm: 14.5,
        minTempC: null,
        maxTempC: 22,
        windKmh: 30,
        conditions: 'Showers',
      }),
    ).toBe('14.5 mm rain, Showers, max 22°C, wind 30 km/h');
    expect(weatherText(null)).toBe('No weather recorded');
  });
});

describe('evidence', () => {
  it('adds up diary hours, RFI days, rain days and notices', () => {
    const s = summariseEvidence([
      item({ id: 'a', hours: 6 }),
      item({ id: 'b', hours: 2.5, onDate: '2027-03-12' }),
      item({ id: 'c', kind: 'rfi_late', hours: null, days: 5, onDate: '2027-03-01' }),
      item({ id: 'd', kind: 'weather_day', hours: null, rainMm: 18.5, onDate: '2027-03-10' }),
      item({ id: 'e', kind: 'correspondence', hours: null, onDate: null }),
    ]);
    expect(s).toMatchObject({
      items: 5,
      diaryHours: 8.5,
      rfiDays: 5,
      rainDays: 1,
      rainMm: 18.5,
      notices: 1,
      firstDate: '2027-03-01',
      lastDate: '2027-03-12',
    });
  });
  it('counts both ends of the span, and runs to today while the delay continues', () => {
    expect(spanDays('2027-03-10', '2027-03-12', '2027-04-01')).toBe(3);
    expect(spanDays('2027-03-10', null, '2027-03-15')).toBe(6);
    expect(spanDays('2027-03-10', null, '2027-03-01')).toBe(1);
  });
});

const ev = (over: Partial<FlagEvent>): FlagEvent => ({
  id: 'e1',
  number: 1,
  status: 'draft',
  startedOn: '2027-03-01',
  endedOn: '2027-03-03',
  awareOn: '2027-03-01',
  noticeDueOn: null,
  claimDueOn: null,
  noticeSentOn: null,
  claimSentOn: null,
  daysClaimed: 2,
  evidence: summariseEvidence([item({})]),
  ...over,
});
const flags = (
  events: FlagEvent[],
  today: string,
  extra: Partial<Parameters<typeof computeFlags>[0]> = {},
) => computeFlags({ today, settings: S, events, untracked: [], wetDaysUsed: 0, ...extra });

describe('computeFlags', () => {
  it('warns when the notice period is running out and is high once it has passed', () => {
    // Aware 1 March, 14 calendar days: ends 15 March.
    expect(flags([ev({})], '2027-03-12')[0]).toMatchObject({
      kind: 'notice_due_soon',
      severity: 'medium',
    });
    expect(flags([ev({})], '2027-03-14')[0]).toMatchObject({
      kind: 'notice_due_soon',
      severity: 'high',
    });
    const late = flags([ev({})], '2027-03-16');
    expect(late[0]).toMatchObject({ kind: 'notice_overdue', severity: 'high' });
    expect(late[0]!.message).toContain('15/03/2027');
  });
  it('stays quiet about a notice that was given, and moves on to the claim period', () => {
    const e = ev({ status: 'notice_given', noticeSentOn: '2027-03-02' });
    expect(flags([e], '2027-03-16')).toEqual([]);
    expect(flags([e], '2027-03-27')[0]).toMatchObject({ kind: 'claim_due_soon' });
    expect(flags([e], '2027-04-01')[0]).toMatchObject({ kind: 'claim_overdue' });
  });
  it('ignores closed and withdrawn events', () => {
    expect(
      flags(
        [ev({ status: 'closed' }), ev({ status: 'withdrawn', id: 'e2', number: 2 })],
        '2027-06-01',
      ),
    ).toEqual([]);
  });
  it('flags delays marked as possible EOT that no event covers, soonest deadline first', () => {
    const f = flags([], '2027-03-12', {
      untracked: [
        { date: '2027-03-06', label: 'Late steel' },
        { date: '2027-02-20', label: 'Rain' },
        { date: '2027-03-10', label: 'Plenty of time' },
      ],
    });
    // 14 calendar days from each day: 6 Mar ends 20 Mar (8 left, not yet shown); 20 Feb ended 6 Mar.
    expect(f.map((x) => x.kind)).toEqual(['untracked_delay']);
    expect(f[0]!.message).toContain('Rain');
    expect(f[0]!.message).toContain('ended 06/03/2027');
    expect(f[0]!.severity).toBe('high');
    const soon = flags([], '2027-03-14', {
      untracked: [{ date: '2027-03-06', label: 'Late steel' }],
    });
    expect(soon[0]).toMatchObject({ severity: 'medium' });
    expect(soon[0]!.message).toContain('ends in 6 days');
  });
  it('does not flag a delay whose notice period has plenty of time left', () => {
    expect(
      flags([], '2027-03-12', { untracked: [{ date: '2027-03-12', label: 'Fresh' }] }),
    ).toEqual([]);
  });
  it('says estimates come from the default until the periods are confirmed', () => {
    const f = computeFlags({
      today: '2027-03-20',
      settings: DEFAULT_SETTINGS,
      events: [ev({})],
      untracked: [],
      wetDaysUsed: 0,
    });
    expect(f.find((x) => x.kind === 'notice_overdue')!.message).toContain(
      'not yet checked against the contract',
    );
    expect(f.some((x) => x.kind === 'periods_unconfirmed')).toBe(true);
  });
  it('flags an event with no evidence, days beyond the span, a long-unassessed claim and too many wet days', () => {
    const f = flags(
      [
        ev({
          noticeSentOn: '2027-03-02',
          claimSentOn: '2027-03-05',
          status: 'notice_given',
          evidence: none,
          daysClaimed: 9,
        }),
        ev({
          id: 'e2',
          number: 2,
          status: 'claimed',
          noticeSentOn: '2027-03-02',
          claimSentOn: '2027-03-05',
        }),
      ],
      '2027-04-10',
      { settings: { ...S, wetDayAllowance: 5 }, wetDaysUsed: 6 },
    ).map((x) => x.kind);
    expect(f).toEqual(
      expect.arrayContaining([
        'no_evidence',
        'days_over_span',
        'assessment_waiting',
        'wet_days_over_allowance',
      ]),
    );
  });
});

describe('draftEotLetter', () => {
  const base = {
    projectName: 'Wharf St',
    senderName: 'Sam Site',
    today: '2027-03-12',
    settings: S,
    event: {
      number: 3,
      title: 'Wet weather, slab level 2',
      cause: 'weather' as const,
      startedOn: '2027-03-10',
      endedOn: '2027-03-11',
      awareOn: '2027-03-10',
      daysClaimed: 2,
      criticalPath: true,
      summary: 'Heavy rain stopped the pour.',
      affected: 'Level 2 slab',
      noticeSentOn: null,
      noticeRefLabel: null,
    },
    items: [
      item({ id: 'a' }),
      item({
        id: 'b',
        kind: 'weather_day',
        hours: null,
        rainMm: 18.5,
        label: 'Rain day: 18.5 mm rain',
      }),
    ],
  };
  it('drafts a notice that quotes the evidence and never says an extension is due', () => {
    const d = draftEotLetter({ ...base, kind: 'notice' });
    expect(d.subject).toBe('Notice of delay: Wet weather, slab level 2 (EOT-003)');
    expect(d.body).toContain('NOTICE OF DELAY');
    expect(d.body).toContain('Date we became aware: 10/03/2027');
    expect(d.body).toContain('- 10/03/2027: Site diary: Rain stopped the slab pour (6 h lost)');
    expect(d.body).toContain('18.5 mm in total, against a 10 mm rain-day threshold');
    expect(d.body).toContain('Clause: [clause number]');
    expect(d.body).toContain('given on the information available now');
    expect(d.body).not.toMatch(/entitled|is due|time bar does not apply/i);
    expect(d.warnings).toEqual([]);
  });
  it('drafts a claim that references the notice and the days claimed', () => {
    const d = draftEotLetter({
      ...base,
      kind: 'claim',
      settings: { ...S, claimClause: 'cl 34.3' },
      event: {
        ...base.event,
        noticeSentOn: '2027-03-11',
        noticeRefLabel: 'NOD-004 Notice of delay',
      },
    });
    expect(d.body).toContain('CLAIM FOR EXTENSION OF TIME');
    expect(d.body).toContain('Reference notice of delay: NOD-004 Notice of delay');
    expect(d.body).toContain('Days claimed: 2');
    expect(d.body).toContain('Period of delay: from 10/03/2027 to 11/03/2027');
    expect(d.body).toContain('Clause: cl 34.3');
    expect(d.body).toContain('The delay is on the critical path.');
    expect(d.warnings).toEqual([]);
  });
  it('warns about what is missing instead of inventing it', () => {
    const d = draftEotLetter({
      ...base,
      kind: 'claim',
      settings: DEFAULT_SETTINGS,
      items: [],
      event: { ...base.event, daysClaimed: 0, criticalPath: null, endedOn: null },
    });
    expect(d.warnings.join(' ')).toMatch(/AS 4000 default/);
    expect(d.warnings.join(' ')).toMatch(/No evidence/);
    expect(d.warnings.join(' ')).toMatch(/Days claimed is 0/);
    expect(d.warnings.join(' ')).toMatch(/No notice of delay is recorded/);
    expect(d.warnings.join(' ')).toMatch(/critical path/);
    expect(d.body).toContain('from 10/03/2027 and continuing');
    expect(d.body).toContain('Days claimed: [number]');
  });
});
