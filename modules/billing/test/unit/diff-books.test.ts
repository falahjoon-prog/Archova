import { describe, expect, it } from 'vitest';
import { INCREASE_NOTICE_DAYS, diffBooks } from '../../src/application/catalogue';

const row = (
  planCode: string,
  amountCents: number | null,
  unit = 'user_month',
  fromPrice = false,
) => ({
  planCode,
  unit,
  fromPrice,
  amountCents,
});
const now = new Date('2026-11-01T00:00:00Z');
const days = (n: number) => new Date(now.getTime() + n * 86_400_000);

describe('diffBooks', () => {
  const live = [row('team', 9900), row('business', 2400000, 'year', true)];

  it('classifies changes', () => {
    const d = diffBooks(
      live,
      [row('team', 8900), row('business', 2400000, 'year', true), row('pro', 100)],
      null,
      now,
    );
    expect(d.changes.map((c) => [c.planCode, c.kind])).toEqual([
      ['business', 'unchanged'],
      ['pro', 'added'],
      ['team', 'decrease'],
    ]);
    expect(d.hasIncrease).toBe(false);
    expect(d.problems).toEqual([]);
  });

  it('needs notice for an increase, and for a plan becoming "from" priced', () => {
    const up = diffBooks(live, [row('team', 10900), live[1]!], days(30), now);
    expect(up.hasIncrease).toBe(true);
    expect(up.problems[0]).toMatch(/60 days/);
    expect(up.earliestEffectiveFrom).toBe(days(INCREASE_NOTICE_DAYS).toISOString());
    expect(diffBooks(live, [row('team', 10900), live[1]!], days(60), now).problems).toEqual([]);
    expect(
      diffBooks([row('team', 9900)], [row('team', 9900, 'user_month', true)], null, now)
        .hasIncrease,
    ).toBe(true);
  });

  it('flags a book identical to the live one, and a unit change counts as an increase', () => {
    expect(diffBooks(live, live, null, now).problems).toEqual([
      'Nothing changed from the live price book.',
    ]);
    expect(
      diffBooks([row('team', 9900)], [row('team', 9900, 'year')], days(70), now).hasIncrease,
    ).toBe(true);
  });

  it('removing a plan is not an increase', () => {
    const d = diffBooks(live, [live[0]!], null, now);
    expect(d.changes.find((c) => c.planCode === 'business')!.kind).toBe('removed');
    expect(d.hasIncrease).toBe(false);
  });
});
