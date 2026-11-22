import { SOPA_RULES } from '@archova/domain';
import { describe, expect, it } from 'vitest';
import { EMPTY_ADJUDICATION, validateAdjudication } from '../../src/domain/adjudication';
import { claimTimeline, type TimelineInput } from '../../src/domain/claim-timeline';

const ctx = { servedOn: '2026-10-14', today: '2026-12-10' };
const facts = (f: Partial<typeof EMPTY_ADJUDICATION>) => ({ ...EMPTY_ADJUDICATION, ...f });
const paths = (f: Partial<typeof EMPTY_ADJUDICATION>) =>
  validateAdjudication(facts(f), ctx).map((p) => p.path);

describe('validateAdjudication', () => {
  it('accepts an empty record and a complete one', () => {
    expect(paths({})).toEqual([]);
    expect(
      paths({
        noticeServedOn: '2026-11-10',
        applicationLodgedOn: '2026-11-20',
        adjudicatorAppointedOn: '2026-11-25',
        responseDueOn: '2026-12-02',
        responseLodgedOn: '2026-12-01',
        determinationDueOn: '2026-12-16',
        determinedOn: '2026-12-09',
        outcome: 'part_upheld',
        adjudicatedAmount: '12000.00',
      }),
    ).toEqual([]);
  });

  it('refuses things that happened in the future or before the claim was served', () => {
    expect(paths({ applicationLodgedOn: '2026-12-11' })).toEqual(['applicationLodgedOn']);
    expect(paths({ noticeServedOn: '2026-10-01' })).toEqual(['noticeServedOn']);
    // due dates may be in the future
    expect(paths({ applicationLodgedOn: '2026-12-01', responseDueOn: '2027-01-05' })).toEqual([]);
  });

  it('refuses steps out of order', () => {
    expect(paths({ noticeServedOn: '2026-11-10', applicationLodgedOn: '2026-11-09' })).toEqual([
      'applicationLodgedOn',
    ]);
    expect(
      paths({ applicationLodgedOn: '2026-11-20', adjudicatorAppointedOn: '2026-11-19' }),
    ).toEqual(['adjudicatorAppointedOn']);
    expect(paths({ adjudicatorAppointedOn: '2026-11-19' })).toEqual(['applicationLodgedOn']);
  });

  it('needs an outcome for a determination, and a date for an outcome', () => {
    expect(paths({ applicationLodgedOn: '2026-11-20', determinedOn: '2026-12-01' })).toEqual([
      'outcome',
    ]);
    expect(paths({ applicationLodgedOn: '2026-11-20', outcome: 'upheld' })).toEqual([
      'determinedOn',
    ]);
    // withdrawn or settled need no determination
    expect(paths({ applicationLodgedOn: '2026-11-20', outcome: 'withdrawn' })).toEqual([]);
  });

  it('ties an adjudicated amount to a determination, and none to a dismissal', () => {
    expect(paths({ adjudicatedAmount: '1.00' })).toEqual(['adjudicatedAmount']);
    expect(
      paths({
        applicationLodgedOn: '2026-11-20',
        determinedOn: '2026-12-01',
        outcome: 'dismissed',
        adjudicatedAmount: '5.00',
      }),
    ).toEqual(['adjudicatedAmount']);
  });
});

// NSW head claim, no schedule given: served 14 Oct, schedule due 28 Oct, payment due 4 Nov.
const base: TimelineInput = {
  ruleState: 'NSW',
  isValid: true,
  servedOn: '2026-10-14',
  scheduleDueOn: '2026-10-28',
  paymentDueOn: '2026-11-04',
  claimedTotalCents: 1_100_000,
  schedule: null,
  paidCents: 0,
  today: '2026-12-10',
  timeZone: 'Australia/Sydney',
};
const step = (t: ReturnType<typeof claimTimeline>, key: string) => t.find((s) => s.key === key);

describe('claimTimeline with an adjudication record', () => {
  it('does not change without a record', () => {
    expect(claimTimeline({ ...base, adjudication: null })).toEqual(claimTimeline(base));
  });

  it('marks the notice done and shows the respondent and apply-by days that follow it', () => {
    const t = claimTimeline({
      ...base,
      today: '2026-11-12',
      adjudication: facts({ noticeServedOn: '2026-11-10' }),
    });
    expect(step(t, 'adjudication_notice')).toMatchObject({ status: 'done', doneOn: '2026-11-10' });
    expect(step(t, 'adjudication_respondent')?.dueOn).toBeTruthy();
    expect(step(t, 'adjudication_apply')?.dueOn).toBeTruthy();
  });

  it('adds the application, adjudicator, response and determination steps', () => {
    const t = claimTimeline({
      ...base,
      adjudication: facts({
        noticeServedOn: '2026-11-10',
        applicationLodgedOn: '2026-11-20',
        adjudicatorName: 'A. Person',
        nominatingAuthority: 'Example ANA',
        adjudicatorAppointedOn: '2026-11-25',
        responseDueOn: '2026-12-02',
        determinationDueOn: '2026-12-08',
      }),
    });
    expect(step(t, 'adjudication_application')).toMatchObject({ status: 'done' });
    expect(step(t, 'adjudication_adjudicator')?.label).toContain('A. Person');
    // today is 10 Dec: both adjudicator dates have passed with nothing recorded
    expect(step(t, 'adjudication_response')).toMatchObject({ status: 'overdue' });
    expect(step(t, 'adjudication_determination')).toMatchObject({ status: 'overdue' });
  });

  it('closes the open steps once there is an outcome', () => {
    const t = claimTimeline({
      ...base,
      adjudication: facts({
        applicationLodgedOn: '2026-11-20',
        responseDueOn: '2026-12-02',
        outcome: 'settled',
      }),
    });
    expect(step(t, 'adjudication_response')?.status).toBe('done');
    expect(step(t, 'adjudication_determination')?.status).toBe('done');
  });

  it('says so when the application was lodged after the last day to apply', () => {
    const t = claimTimeline({
      ...base,
      today: '2027-03-01',
      adjudication: facts({ noticeServedOn: '2026-11-10', applicationLodgedOn: '2027-02-20' }),
    });
    expect(step(t, 'adjudication_application')?.note).toContain('after the likely last day');
  });
});

describe('suggested response and determination dates (compliance/01b)', () => {
  const signed = SOPA_RULES.map((r) => (r.state === 'NSW' ? { ...r, verifiedBy: 'Lawyer' } : r));
  const run = (adjudication: ReturnType<typeof facts>) =>
    claimTimeline({ ...base, adjudication, rules: signed });
  const lodged = { noticeServedOn: '2026-11-10', applicationLodgedOn: '2026-11-20' } as const;

  it('suggests nothing while the state’s rules are not signed off', () => {
    const t = claimTimeline({
      ...base,
      adjudication: facts({ ...lodged, applicationReceivedOn: '2026-11-23' }),
    });
    expect(step(t, 'adjudication_response')?.suggestedOn).toBeNull();
    expect(step(t, 'adjudication_determination')?.suggestedOn).toBeNull();
  });

  it('suggests the response and decision days beside the typed dates, and flags a difference', () => {
    const t = run(
      facts({
        ...lodged,
        applicationReceivedOn: '2026-11-23',
        acceptanceNoticeReceivedOn: '2026-11-25',
        responseDueOn: '2026-12-01',
      }),
    );
    // 23 Nov + 5 BD = 30 Nov; 25 Nov + 2 BD = 27 Nov; the later is 30 Nov.
    expect(step(t, 'adjudication_response')).toMatchObject({
      dueOn: '2026-12-01',
      suggestedOn: '2026-11-30',
    });
    expect(step(t, 'adjudication_response')?.note).toContain('check the notice');
    // Decision runs from the typed response due date: 1 Dec + 10 BD = 15 Dec.
    expect(step(t, 'adjudication_determination')?.suggestedOn).toBe('2026-12-15');
  });

  it('says it matches when the typed date agrees', () => {
    const t = run(
      facts({
        ...lodged,
        applicationReceivedOn: '2026-11-23',
        acceptanceNoticeReceivedOn: '2026-11-25',
        responseDueOn: '2026-11-30',
      }),
    );
    expect(step(t, 'adjudication_response')?.note).toContain('matches the rules');
  });

  it('calls the suggestion a floor until the acceptance notice is known', () => {
    const t = run(facts({ ...lodged, applicationReceivedOn: '2026-11-23' }));
    expect(step(t, 'adjudication_response')?.note).toContain('at least 2026-11-30');
  });
});
