import { describe, expect, it } from 'vitest';
import { claimTotals, isClaimError } from '../../src/domain/claim';
import { fromCents, percentOf, toCents } from '../../src/domain/money';

const item = (sovItemId: string, itemValue: number, previous: number, thisClaim: number) => ({
  sovItemId,
  itemValue,
  previous,
  thisClaim,
});

describe('money', () => {
  it('round-trips decimals exactly', () => {
    expect(toCents('1234.5')).toBe(123_450);
    expect(fromCents(toCents('0.07'))).toBe('0.07');
    expect(() => toCents('1.234')).toThrow();
    expect(percentOf(100_000, 1000)).toBe(10_000);
    expect(percentOf(333, 1000)).toBe(33);
  });
});

describe('claimTotals (CLM-AC6)', () => {
  it('works out retention and GST on this claim only', () => {
    const t = claimTotals({
      lines: [item('a', 100_000_00, 20_000_00, 30_000_00), item('b', 50_000_00, 0, 10_000_00)],
      retentionPct: 500,
      retentionCap: null,
      retentionHeld: 0,
    });
    if (isClaimError(t)) throw new Error('unexpected');
    expect(t).toMatchObject({
      gross: 60_000_00,
      lessPrevious: 20_000_00,
      retention: 2_000_00,
      net: 38_000_00,
      gst: 3_800_00,
      total: 41_800_00,
    });
    expect(t.lines[0]).toMatchObject({ previous: 20_000_00, toDate: 50_000_00 });
  });

  it('stops retention at the cap', () => {
    const t = claimTotals({
      lines: [item('a', 100_000_00, 0, 40_000_00)],
      retentionPct: 500,
      retentionCap: 3_000_00,
      retentionHeld: 2_500_00,
    });
    if (isClaimError(t)) throw new Error('unexpected');
    expect(t.retention).toBe(500_00);
  });

  it('blocks a line taken past 100% of its value', () => {
    const t = claimTotals({
      lines: [item('a', 10_000_00, 9_000_00, 1_500_00)],
      retentionPct: 0,
      retentionCap: null,
      retentionHeld: 0,
    });
    expect(t).toMatchObject({ code: 'financials.claim.over_item_value', toDate: 10_500_00 });
  });

  it('refuses an empty claim and a repeated item', () => {
    const base = { retentionPct: 0, retentionCap: null, retentionHeld: 0 };
    expect(claimTotals({ ...base, lines: [item('a', 1000, 0, 0)] })).toMatchObject({
      code: 'financials.claim.empty',
    });
    expect(
      claimTotals({ ...base, lines: [item('a', 1000, 0, 100), item('a', 1000, 0, 100)] }),
    ).toMatchObject({ code: 'financials.claim.duplicate_item' });
  });
});

describe('claimTotals with variations (CLM-AC13)', () => {
  it('treats a variation line as an item capped at its own amount', () => {
    const ok = claimTotals({
      lines: [
        item('a', 100_000_00, 0, 10_000_00),
        { variationId: 'v1', itemValue: 5_000_00, previous: 1_000_00, thisClaim: 2_000_00 },
      ],
      retentionPct: 0,
      retentionCap: null,
      retentionHeld: 0,
    });
    if (isClaimError(ok)) throw new Error('unexpected');
    expect(ok.gross).toBe(13_000_00);
    expect(ok.lines[1]).toMatchObject({ variationId: 'v1', toDate: 3_000_00 });
    const over = claimTotals({
      lines: [{ variationId: 'v1', itemValue: 5_000_00, previous: 4_000_00, thisClaim: 1_000_01 }],
      retentionPct: 0,
      retentionCap: null,
      retentionHeld: 0,
    });
    expect(over).toMatchObject({ code: 'financials.claim.over_item_value', sovItemId: 'v1' });
  });
});
