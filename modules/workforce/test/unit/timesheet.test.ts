import { describe, expect, it } from 'vitest';
import {
  MAX_DAY_MINUTES,
  TRANSITIONS,
  dayProblem,
  isEditable,
  totals,
} from '../../src/domain/timesheet';

describe('timesheet rules', () => {
  it('adds up minutes and breaks', () => {
    expect(
      totals([
        { minutes: 180, breakMinutes: 30 },
        { minutes: 60, breakMinutes: 0 },
      ]),
    ).toEqual({ totalMinutes: 240, breakMinutes: 30 });
    expect(totals([])).toEqual({ totalMinutes: 0, breakMinutes: 0 });
  });

  it('only lets hours change while draft or sent back', () => {
    expect(isEditable('draft')).toBe(true);
    expect(isEditable('rejected')).toBe(true);
    for (const s of ['submitted', 'approved', 'exported'] as const)
      expect(isEditable(s)).toBe(false);
  });

  it('refuses more than a day, and a break longer than the stint', () => {
    expect(dayProblem([{ minutes: MAX_DAY_MINUTES, breakMinutes: 0 }])).toBeNull();
    expect(
      dayProblem([
        { minutes: 1000, breakMinutes: 0 },
        { minutes: 441, breakMinutes: 0 },
      ]),
    ).toBe('day_too_long');
    expect(dayProblem([{ minutes: 30, breakMinutes: 45 }])).toBe('break_too_long');
  });

  it('moves through submit, approve and send back only from the right state', () => {
    expect(TRANSITIONS.submit.from).toContain('rejected');
    expect(TRANSITIONS.approve.from).toEqual(['submitted']);
    expect(TRANSITIONS.approve.to).toBe('approved');
    expect(TRANSITIONS.reject.from).toContain('approved');
  });
});
