import { describe, expect, it } from 'vitest';
import type { BidLevelOutput } from '@archova/ai-prompts';
import { levelBids, reviewLevelling, type BidsForLevelling } from '../../src/domain/bid-levelling';

const SCOPE = [
  { key: 'floor', description: 'Floor tiles', unit: 'm2' },
  { key: 'wall', description: 'Wall tiles', unit: 'm2' },
  { key: 'waterproof', description: 'Waterproofing', unit: 'm2' },
];
const cell = (scopeKey: string, amountExGst: string | null, extra = {}) => ({
  scopeKey,
  amountExGst,
  provisional: false,
  excluded: false,
  ...extra,
});
const bid = (
  label: string,
  totalExGst: string,
  cells: ReturnType<typeof cell>[],
  extra: Partial<BidsForLevelling['bids'][number]> = {},
): BidsForLevelling['bids'][number] => ({
  label,
  quoteId: `q-${label}`,
  totalExGst,
  validUntil: null,
  validityExpired: false,
  cells,
  unmapped: [],
  exclusions: [],
  qualifications: [],
  ...extra,
});

const FIELD: BidsForLevelling = {
  trade: 'Tiling',
  scope: SCOPE,
  bids: [
    bid('Bid A', '40000.00', [
      cell('floor', '25000.00'),
      cell('wall', '15000.00'),
      cell('waterproof', null, { excluded: true }),
    ]),
    bid('Bid B', '48000.00', [
      cell('floor', '24000.00'),
      cell('wall', '15000.00'),
      cell('waterproof', '9000.00'),
    ]),
    bid('Bid C', '50000.00', [
      cell('floor', '25000.00'),
      cell('wall', '15000.00'),
      cell('waterproof', '10000.00'),
    ]),
  ],
};

const out = (over: Partial<BidLevelOutput> = {}): BidLevelOutput => ({
  summary: 'Bid B has the lowest normalised total.',
  mappings: [],
  gaps: [{ bid: 'Bid A', scopeKey: 'waterproof', text: 'Bid A excludes waterproofing.' }],
  risks: [],
  recommendation: { bid: 'Bid B', reasoning: 'Complete scope at the best price.', conditions: [] },
  ...over,
});

describe('levelBids', () => {
  const l = levelBids(FIELD);
  it('adds the median of the other bids for a gap and ranks on the normalised total', () => {
    const a = l.bids[0]!;
    expect(a.gaps).toEqual([
      { scopeKey: 'waterproof', reason: 'excluded', allowanceExGst: '9500.00' },
    ]);
    expect(a.normalisedExGst).toBe('49500.00');
    expect(l.bids.map((b) => b.rank)).toEqual([2, 1, 3]);
    expect(l.medianNormalisedExGst).toBe('49500.00');
  });
  it('puts no allowance on a gap fewer than two other bids price', () => {
    const two = levelBids({ ...FIELD, bids: FIELD.bids.slice(0, 2) });
    expect(two.bids[0]!.gaps[0]!.allowanceExGst).toBeNull();
    expect(two.bids[0]!.normalisedExGst).toBe('40000.00');
    expect(two.medianNormalisedExGst).toBeNull();
  });
});

describe('reviewLevelling', () => {
  const l = levelBids(FIELD);
  it('keeps a sound answer untouched and says whether the pick is the lowest', () => {
    const r = reviewLevelling(out(), FIELD, l);
    expect(r.notes).toEqual([]);
    expect(r.recommendation).toMatchObject({
      bid: 'Bid B',
      quoteId: 'q-Bid B',
      isLowestNormalised: true,
    });
  });
  it('drops unknown bids, unknown scope lines and unmatched lines that do not exist', () => {
    const f: BidsForLevelling = {
      ...FIELD,
      bids: [
        {
          ...FIELD.bids[0]!,
          unmapped: [{ ref: 'u1', description: 'Membrane', amountExGst: '3000.00' }],
        },
        ...FIELD.bids.slice(1),
      ],
    };
    const r = reviewLevelling(
      out({
        mappings: [
          { bid: 'Bid A', ref: 'u1', scopeKey: 'waterproof', reason: 'Membrane is waterproofing.' },
          { bid: 'Bid A', ref: 'u9', scopeKey: 'waterproof', reason: 'x' },
          { bid: 'Bid A', ref: 'u1', scopeKey: 'nope', reason: 'x' },
        ],
        gaps: [{ bid: 'Bid Z', scopeKey: null, text: 'Ghost.' }],
      }),
      f,
      levelBids(f),
    );
    expect(r.mappings).toHaveLength(1);
    expect(r.gaps).toEqual([]);
    expect(r.notes.length).toBe(2);
  });
  it('removes figures the bids do not hold but allows differences between normalised totals', () => {
    const r = reviewLevelling(
      out({ summary: 'Bid B is $1500.00 below Bid A. The budget is $99999.00.' }),
      FIELD,
      l,
    );
    expect(r.summary).toBe('Bid B is $1500.00 below Bid A.');
    expect(r.notes).toContain('Sentences with figures that are not in the bids were removed.');
  });
  it('recommends nothing for one bid or an unknown bid', () => {
    const one = { ...FIELD, bids: [FIELD.bids[1]!] };
    expect(reviewLevelling(out(), one, levelBids(one)).recommendation.bid).toBeNull();
    const r = reviewLevelling(
      out({ recommendation: { bid: 'Bid Q', reasoning: '', conditions: [] } }),
      FIELD,
      l,
    );
    expect(r.recommendation.bid).toBeNull();
  });
  it('adds renewing the validity when the recommended bid has expired', () => {
    const f = { ...FIELD, bids: [{ ...FIELD.bids[1]!, validityExpired: true }, FIELD.bids[2]!] };
    const r = reviewLevelling(out(), f, levelBids(f));
    expect(r.recommendation.conditions.join(' ')).toMatch(/renew/i);
  });
});
