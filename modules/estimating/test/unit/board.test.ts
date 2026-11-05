import { describe, expect, it } from 'vitest';
import { dueState, lowestLevelledCents, tallyInvites } from '../../src/domain/board';
import { toCents } from '../../src/domain/tender';

const now = new Date('2026-11-05T00:00:00Z');
const hours = (h: number) => new Date(now.getTime() + h * 3_600_000);

describe('dueState', () => {
  it('is only set while the package is out to tender with a due date', () => {
    expect(dueState('draft', hours(1), now)).toBeNull();
    expect(dueState('closed', hours(-5), now)).toBeNull();
    expect(dueState('out_to_tender', null, now)).toBeNull();
  });
  it('is overdue once the due time has passed', () => {
    expect(dueState('out_to_tender', hours(-1), now)).toBe('overdue');
  });
  it('is closing soon within 72 hours, inclusive, and open after', () => {
    expect(dueState('out_to_tender', hours(72), now)).toBe('closing_soon');
    expect(dueState('out_to_tender', hours(72.01), now)).toBe('open');
  });
});

describe('tallyInvites', () => {
  it('counts each answer and the invitees still to respond', () => {
    expect(
      tallyInvites(['invited', 'viewed', 'viewed', 'declined', 'intends_to_quote', 'submitted']),
    ).toEqual({
      invited: 1,
      viewed: 2,
      declined: 1,
      intendsToQuote: 1,
      submitted: 1,
      awaiting: 3,
    });
  });
});

describe('lowestLevelledCents', () => {
  const quotes = [
    { id: 'a', status: 'confirmed', totalExGst: '1000.00' },
    { id: 'b', status: 'confirmed', totalExGst: '900.00' },
    { id: 'c', status: 'declined', totalExGst: '10.00' },
  ];
  it('is the cheapest confirmed quote after allowances', () => {
    expect(lowestLevelledCents(quotes, {}, toCents)).toBe(90000);
    expect(lowestLevelledCents(quotes, { 'b:x': '150.00' }, toCents)).toBe(100000);
  });
  it('is null with nothing confirmed', () => {
    expect(lowestLevelledCents([quotes[2]!], {}, toCents)).toBeNull();
  });
});
