import { describe, expect, it } from 'vitest';
import { canMove, filled, overlaps } from '../../src/domain/roster';

const t = (h: number) => new Date(Date.UTC(2026, 10, 6, h));

describe('rosters', () => {
  it('treats back-to-back shifts as not overlapping', () => {
    expect(overlaps({ startsAt: t(7), endsAt: t(15) }, { startsAt: t(15), endsAt: t(17) })).toBe(
      false,
    );
    expect(overlaps({ startsAt: t(7), endsAt: t(15) }, { startsAt: t(14), endsAt: t(17) })).toBe(
      true,
    );
  });

  it('does not count declined workers against the headcount', () => {
    expect(filled(['offered', 'accepted', 'declined', 'attended'])).toBe(3);
  });

  it('lets a worker answer an offer, but only a manager record attendance after the start', () => {
    expect(canMove('offered', 'accepted', 'worker', false)).toBe(true);
    expect(canMove('accepted', 'declined', 'worker', false)).toBe(true);
    expect(canMove('accepted', 'accepted', 'worker', false)).toBe(false);
    expect(canMove('accepted', 'attended', 'worker', true)).toBe(false);
    expect(canMove('accepted', 'attended', 'manager', false)).toBe(false);
    expect(canMove('accepted', 'no_show', 'manager', true)).toBe(true);
    expect(canMove('declined', 'attended', 'manager', true)).toBe(false);
  });
});
