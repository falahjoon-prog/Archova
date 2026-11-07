import { describe, expect, it } from 'vitest';
import {
  computeGap,
  figuresIn,
  gapSentence,
  reviewNegotiation,
  type NegotiateFacts,
} from '../../src/domain/quote-negotiate';

const out = (over: Partial<Parameters<typeof reviewNegotiation>[0]> = {}) => ({
  reply: 'This quote is above the median.',
  points: [{ scopeKey: 'skirting', text: 'No price for skirting.' }],
  levers: ['Ask about phasing.'],
  counterExGst: '55000.00' as string | null,
  counterReason: 'Halfway between the median and the quote.',
  draftMessage: 'Thanks for your quote of $62000.00.' as string | null,
  ...over,
});

const facts = (total: string, target: string | null, quotes = 3): NegotiateFacts => ({
  scopeKeys: new Set(['skirting', 'lobby_floor']),
  totalExGst: total,
  gap: computeGap({
    totalExGst: total,
    targetExGst: target,
    field: { quotes, medianExGst: '50000.00' },
  }),
  lowestExGst: '44000.00',
  medianExGst: '50000.00',
  lineAmounts: ['12000.00', null],
});

describe('computeGap', () => {
  const field = { quotes: 3, medianExGst: '50000.00' };
  it('measures against the target price first', () => {
    expect(computeGap({ totalExGst: '62000.00', targetExGst: '40000.00', field })).toMatchObject({
      against: 'target',
      differenceExGst: '22000.00',
      percent: 55,
      stance: 'above',
    });
  });
  it('uses the median of three or more quotes when there is no target', () => {
    expect(computeGap({ totalExGst: '36000.00', targetExGst: null, field })).toMatchObject({
      against: 'median',
      differenceExGst: '-14000.00',
      stance: 'below',
    });
    expect(computeGap({ totalExGst: '51000.00', targetExGst: null, field }).stance).toBe('within');
  });
  it('has no reference with fewer than three quotes and no target', () => {
    const g = computeGap({
      totalExGst: '48000.00',
      targetExGst: null,
      field: { quotes: 2, medianExGst: null },
    });
    expect(g).toMatchObject({ stance: 'no_reference', against: null, percent: null });
    expect(gapSentence(g)).toMatch(/can't say/);
  });
});

describe('reviewNegotiation', () => {
  it('keeps a counter-offer between half the quote and the quote when above', () => {
    expect(reviewNegotiation(out(), facts('62000.00', null)).counterExGst).toBe('55000.00');
  });
  it('drops a counter that is too low, too high, or given when not above', () => {
    for (const c of ['20000.00', '62000.00', '70000.00']) {
      const r = reviewNegotiation(out({ counterExGst: c }), facts('62000.00', null));
      expect(r.counterExGst).toBeNull();
      expect(r.notes.join(' ')).toMatch(/counter-offer/);
    }
    expect(reviewNegotiation(out(), facts('36000.00', null)).counterExGst).toBeNull();
  });
  it('removes figures the quote does not hold, and never invents a budget', () => {
    const r = reviewNegotiation(
      out({
        reply: 'Your budget of $41,000.00 is tight. This quote is above the median.',
        draftMessage: 'Another firm quoted $45,000.00.',
        points: [{ scopeKey: 'nope', text: 'Compare with the $9,999.00 quote.' }],
      }),
      facts('62000.00', null),
    );
    expect(r.reply).toBe('This quote is above the median.');
    expect(r.draftMessage).toBeNull();
    expect(r.points).toEqual([]);
  });
  it("unknown scope keys become null and the reply falls back to code's own sentence", () => {
    const r = reviewNegotiation(
      out({ reply: 'It costs $1.00.', points: [{ scopeKey: 'nope', text: 'No price.' }] }),
      facts('62000.00', null),
    );
    expect(r.points[0]!.scopeKey).toBeNull();
    expect(r.reply).toMatch(/above the median of the quotes/);
  });
});

it('reads dollar figures with commas and cents', () => {
  expect(figuresIn('$1,200.50 and $30')).toEqual([120050, 3000]);
});
