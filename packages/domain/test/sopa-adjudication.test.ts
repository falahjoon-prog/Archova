import { describe, expect, it } from 'vitest';
import { SOPA_RULES, decisionDue, responseDue, type SopaState } from '../src';

const rule = (state: SopaState) => SOPA_RULES.find((r) => r.state === state)!;
const none = new Set<string>();

// Expected values worked by hand from compliance/01b (not legal advice; the rows are unreviewed).
describe('responseDue', () => {
  it('NSW: the later of 5 BD after the application and 2 BD after the acceptance notice', () => {
    // Application Mon 2 Nov 2026 -> Mon 9 Nov. Acceptance Fri 6 Nov -> Tue 10 Nov. Later wins.
    expect(
      responseDue({
        rule: rule('NSW'),
        holidays: none,
        applicationReceivedOn: '2026-11-02',
        acceptanceReceivedOn: '2026-11-06',
      }),
    ).toEqual({ dueOn: '2026-11-10', final: true });
    // Acceptance on the day of the application: the application limb is later.
    expect(
      responseDue({
        rule: rule('NSW'),
        holidays: none,
        applicationReceivedOn: '2026-11-02',
        acceptanceReceivedOn: '2026-11-02',
      }),
    ).toEqual({ dueOn: '2026-11-09', final: true });
  });

  it('is only a floor until the acceptance notice is known, where the Act has that limb', () => {
    expect(
      responseDue({ rule: rule('NSW'), holidays: none, applicationReceivedOn: '2026-11-02' }),
    ).toEqual({ dueOn: '2026-11-09', final: false });
  });

  it('VIC and WA have one limb, so the result is final without an acceptance notice', () => {
    expect(
      responseDue({ rule: rule('VIC'), holidays: none, applicationReceivedOn: '2026-11-02' }),
    ).toEqual({ dueOn: '2026-11-09', final: true });
    expect(
      responseDue({ rule: rule('WA'), holidays: none, applicationReceivedOn: '2026-11-02' }),
    ).toEqual({ dueOn: '2026-11-16', final: true });
  });

  it('skips the 22 Dec to 10 Jan shutdown in VIC', () => {
    // Fri 18 Dec 2026: Mon 21 Dec is day 1; the shutdown days do not count; 11 to 14 Jan are days 2 to 5.
    expect(
      responseDue({ rule: rule('VIC'), holidays: none, applicationReceivedOn: '2026-12-18' }).dueOn,
    ).toBe('2027-01-14');
  });

  it('QLD standard: the later of 10 BD and 7 BD after acceptance', () => {
    expect(
      responseDue({
        rule: rule('QLD'),
        holidays: none,
        applicationReceivedOn: '2026-11-02',
        acceptanceReceivedOn: '2026-11-09',
      }),
    ).toEqual({ dueOn: '2026-11-18', final: true });
  });
});

describe('decisionDue', () => {
  it('is 10 business days from the day given', () => {
    expect(decisionDue(rule('NSW'), none, '2026-11-10')).toBe('2026-11-24');
    expect(decisionDue(rule('VIC'), none, '2026-12-18')).toBe('2027-01-21');
  });
});

describe('every east-coast row has the windows', () => {
  it('has a positive application limb and 10 BD to decide', () => {
    for (const r of SOPA_RULES) {
      expect(r.adjudication.response.afterApplicationDays).toBeGreaterThan(0);
      expect(r.adjudication.decisionDays).toBe(10);
    }
  });
});
