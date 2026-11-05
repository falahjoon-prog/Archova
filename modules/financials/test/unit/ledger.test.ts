import { describe, expect, it } from 'vitest';
import { allocate, ledgerLines } from '../../src/domain/ledger';

describe('ledger lines', () => {
  it('allocates to the cent', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(5, [])).toEqual([]);
    expect(allocate(7, [0, 0])).toEqual([7, 0]);
  });

  it('keeps lines minus retention equal to the payable amount, and GST at 10% of it', () => {
    const out = ledgerLines(
      [
        { code: 'A', description: 'a', thisClaim: 100_000 },
        { code: 'B', description: 'b', thisClaim: 50_001 },
      ],
      7_500,
      142_501,
    );
    expect(out.reduce((n, l) => n + l.amountCents, 0) - 7_500).toBe(142_501);
    expect(out.reduce((n, l) => n + l.gstCents, 0)).toBe(14_250);
  });

  it('scales every line down when the schedule pays less than the claim', () => {
    const out = ledgerLines([{ code: 'A', description: 'a', thisClaim: 100_000 }], 5_000, 45_000);
    expect(out[0]?.amountCents).toBe(50_000);
    expect(out[0]?.gstCents).toBe(4_500);
  });
});
