import { describe, expect, it } from 'vitest';
import {
  canMove,
  csvCell,
  csvLine,
  editable,
  hoursOf,
  payable,
  totalMinutes,
} from '../../src/domain/timesheet';

describe('timesheet rules', () => {
  it('locks a sheet once approved but reopens it on rejection', () => {
    expect(editable('draft')).toBe(true);
    expect(editable('rejected')).toBe(true);
    expect(editable('submitted')).toBe(false);
    expect(editable('approved')).toBe(false);
    expect(canMove('draft', 'submitted')).toBe(true);
    expect(canMove('submitted', 'rejected')).toBe(true);
    expect(canMove('rejected', 'submitted')).toBe(true);
    expect(canMove('approved', 'draft')).toBe(false);
    expect(canMove('draft', 'approved')).toBe(false);
    expect(canMove('approved', 'exported')).toBe(true);
  });
  it('pays time worked less the break', () => {
    expect(payable({ minutes: 480, breakMinutes: 30 })).toBe(450);
    expect(
      totalMinutes([
        { minutes: 240, breakMinutes: 0 },
        { minutes: 240, breakMinutes: 30 },
      ]),
    ).toBe(450);
    expect(hoursOf(450)).toBe('7.50');
  });
  it('quotes csv cells and defuses formulas', () => {
    expect(csvCell('Dana, Smith')).toBe('"Dana, Smith"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvLine(['a', '1', '-5'])).toBe("a,1,'-5");
  });
});
