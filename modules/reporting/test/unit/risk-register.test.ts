import { describe, expect, it } from 'vitest';
import type { RiskStatus } from '../../src/infra/tables';
import { levelOf, score, summarise } from '../../src/domain/risk-register';

const r = (
  likelihood: number,
  impact: number,
  status: RiskStatus = 'open',
  reviewDate: string | null = null,
) => ({
  likelihood,
  impact,
  status,
  reviewDate,
});

describe('risk register rules', () => {
  it('scores likelihood x impact and bands it', () => {
    expect(score(3, 5)).toBe(15);
    expect(levelOf(15)).toBe('high');
    expect(levelOf(14)).toBe('medium');
    expect(levelOf(8)).toBe('medium');
    expect(levelOf(7)).toBe('low');
  });

  it('is unknown, not green, when nothing was ever recorded', () => {
    expect(summarise([], '2026-11-07').rag).toBeNull();
  });

  it('is red for a live high risk, amber for medium, green for low only', () => {
    expect(summarise([r(5, 5)], '2026-11-07').rag).toBe('red');
    expect(summarise([r(3, 3), r(1, 1)], '2026-11-07').rag).toBe('amber');
    expect(summarise([r(1, 2)], '2026-11-07').rag).toBe('green');
  });

  it('keeps an occurred risk red while it is live, and ignores closed ones', () => {
    expect(summarise([r(1, 1, 'occurred')], '2026-11-07').rag).toBe('red');
    const s = summarise([r(5, 5, 'closed')], '2026-11-07');
    expect(s).toMatchObject({ rag: 'green', open: 0, high: 0 });
  });

  it('counts live risks past their review date', () => {
    const s = summarise(
      [
        r(2, 2, 'open', '2026-11-01'),
        r(2, 2, 'open', '2026-11-07'),
        r(5, 5, 'closed', '2026-01-01'),
      ],
      '2026-11-07',
    );
    expect(s.overdueReviews).toBe(1);
  });
});
