import { describe, expect, it } from 'vitest';
import type { QuotePage, QuoteReadOutput } from '@archova/ai-prompts';
import {
  centsToAmount,
  moneyCents,
  pageAmounts,
  reviewQuoteRead,
  squash,
} from '../../src/domain/quote-read';

const PAGES: QuotePage[] = [
  {
    page: 1,
    text: [
      'Tiles & Surfaces Pty Ltd',
      'Floor tiles supply and lay  120  m2  $34.33  $4,119.60',
      'Wall tiles supply and lay  96  m2  $41.00  $3,936.00',
      'Total ex GST  $8,055.60',
    ].join('\n'),
  },
  {
    page: 2,
    text: ['Exclusions', 'Scaffolding above 2 m', 'Less early award discount  -$100.00'].join('\n'),
  },
];
const SCOPE = [{ key: 'floor' }, { key: 'wall' }];

type Line = QuoteReadOutput['lines'][number];
const line = (over: Partial<Line> = {}): Line => ({
  page: 1,
  snippet: 'Floor tiles supply and lay  120  m2  $34.33  $4,119.60',
  description: 'Floor tiles supply and lay',
  scopeKey: 'floor',
  quantity: '120',
  unit: 'm2',
  rate: '$34.33',
  amount: '$4,119.60',
  provisional: false,
  ...over,
});
const out = (over: Partial<QuoteReadOutput> = {}): QuoteReadOutput => ({
  reference: 'TS-2291',
  validUntil: '2026-04-30',
  prices: 'exclude_gst',
  statedTotal: null,
  lines: [line()],
  exclusions: [],
  qualifications: [],
  ...over,
});

describe('moneyCents', () => {
  it('reads amounts the way quotes print them', () => {
    expect(moneyCents('$4,119.60')).toBe(411960);
    expect(moneyCents('4119.6')).toBe(411960);
    expect(moneyCents('AUD 1,200')).toBe(120000);
    expect(moneyCents('-$450.00')).toBe(-45000);
    expect(moneyCents('($1,200.00)')).toBe(-120000);
    expect(moneyCents('$ 75')).toBe(7500);
  });

  it('refuses what is not an amount', () => {
    for (const s of ['TBC', 'Included', '', '12,34', '$1.234', '(100', '1 200', '$'])
      expect(moneyCents(s), s).toBeNull();
  });

  it('formats cents back to a decimal string', () => {
    expect(centsToAmount(411960)).toBe('4119.60');
    expect(centsToAmount(5)).toBe('0.05');
    expect(centsToAmount(-45000)).toBe('-450.00');
  });
});

describe('pageAmounts', () => {
  it('lists every number printed on a page as cents, quantities included', () => {
    const a = pageAmounts(PAGES[0]!.text);
    expect(a.has(411960)).toBe(true);
    expect(a.has(805560)).toBe(true);
    expect(a.has(12000)).toBe(true);
    expect(a.has(411961)).toBe(false);
  });
});

describe('squash', () => {
  it('ignores case, spacing, punctuation and superscripts', () => {
    expect(squash('Floor  tiles — $4,119.60 / m²')).toBe(squash('floor tiles 4119 60 m2'));
  });
});

describe('reviewQuoteRead', () => {
  it('keeps a clean reading as is, with its sources', () => {
    const r = reviewQuoteRead(out(), SCOPE, PAGES);
    expect(r.lines).toEqual([
      {
        description: 'Floor tiles supply and lay',
        scopeKey: 'floor',
        quantity: '120',
        unit: 'm2',
        rate: '34.33',
        amount: '4119.60',
        isProvisional: false,
        source: { page: 1, snippet: 'Floor tiles supply and lay 120 m2 $34.33 $4,119.60' },
        warning: null,
      },
    ]);
    expect(r).toMatchObject({
      reference: 'TS-2291',
      validUntil: '2026-04-30',
      linesTotalExGst: '4119.60',
      discountsExGst: '0.00',
      totalCheck: 'not_stated',
      statedTotalExGst: null,
      difference: null,
      dropped: 0,
      warnings: [],
    });
  });

  it('finds the page when the model names the wrong one, and drops the link when the words are on no page', () => {
    const r = reviewQuoteRead(
      out({
        lines: [
          line({ page: 2 }),
          line({
            snippet: 'Floor tiles supplied at a special price',
            description: 'Floor tiles special',
            amount: '$4,000.00',
          }),
        ],
      }),
      SCOPE,
      PAGES,
    );
    expect(r.lines[0]).toMatchObject({ source: { page: 1 }, warning: null });
    expect(r.lines[1]).toMatchObject({ source: null, warning: 'source_not_found' });
  });

  it('flags an amount that is not printed on the page it names', () => {
    const r = reviewQuoteRead(out({ lines: [line({ amount: '$4,200.00' })] }), SCOPE, PAGES);
    expect(r.lines[0]).toMatchObject({ amount: '4200.00', warning: 'amount_not_on_page' });
  });

  it('does not accept a snippet too short to prove anything', () => {
    const r = reviewQuoteRead(out({ lines: [line({ snippet: 'Floor' })] }), SCOPE, PAGES);
    expect(r.lines[0]).toMatchObject({ source: null, warning: 'source_not_found' });
  });

  it('keeps discounts and credits out of the lines and sets them against the printed total', () => {
    const r = reviewQuoteRead(
      out({
        statedTotal: '$7,955.60',
        lines: [
          line(),
          line({
            snippet: 'Wall tiles supply and lay  96  m2  $41.00  $3,936.00',
            description: 'Wall tiles supply and lay',
            scopeKey: 'wall',
            quantity: '96',
            rate: '$41.00',
            amount: '$3,936.00',
          }),
          line({
            page: 2,
            snippet: 'Less early award discount  -$100.00',
            description: 'Less early award discount',
            scopeKey: null,
            quantity: null,
            unit: null,
            rate: null,
            amount: '-$100.00',
          }),
        ],
      }),
      SCOPE,
      [PAGES[0]!, { page: 2, text: PAGES[1]!.text + '\nTotal ex GST  $7,955.60' }],
    );
    expect(r.lines.map((l) => l.amount)).toEqual(['4119.60', '3936.00']);
    expect(r.qualifications).toEqual([
      expect.objectContaining({
        text: 'Discount or credit: Less early award discount (-$100.00)',
        source: expect.objectContaining({ page: 2 }),
      }),
    ]);
    expect(r).toMatchObject({
      linesTotalExGst: '8055.60',
      discountsExGst: '100.00',
      statedTotalExGst: '7955.60',
      totalCheck: 'matches',
      difference: '0.00',
    });
    expect(r.warnings).toEqual(['discounts_as_qualifications']);
  });

  it('says when the lines do not add up to the total the quote prints', () => {
    const r = reviewQuoteRead(out({ statedTotal: '$8,055.60' }), SCOPE, PAGES);
    expect(r).toMatchObject({
      totalCheck: 'differs',
      statedTotalExGst: '8055.60',
      linesTotalExGst: '4119.60',
      difference: '-3936.00',
    });
    expect(r.warnings).toContain('total_differs');
  });

  it('ignores a printed total that is on no page, and warns', () => {
    const r = reviewQuoteRead(out({ statedTotal: '$1.00' }), SCOPE, PAGES);
    expect(r).toMatchObject({ statedTotalExGst: null, totalCheck: 'not_stated' });
    expect(r.warnings).toContain('stated_total_not_on_page');
  });

  it('warns when the quote says its prices include GST', () => {
    expect(reviewQuoteRead(out({ prices: 'include_gst' }), SCOPE, PAGES).warnings).toEqual([
      'prices_include_gst',
    ]);
  });

  it('drops lines with no readable amount or a description, and repeats, and counts them', () => {
    const r = reviewQuoteRead(
      out({
        lines: [
          line(),
          line(),
          line({ description: 'Acoustic insulation', amount: 'TBC' }),
          line({ description: '   ' }),
        ],
      }),
      SCOPE,
      PAGES,
    );
    expect(r.lines).toHaveLength(1);
    expect(r.dropped).toBe(3);
    expect(r.warnings).toEqual(['items_dropped']);
  });

  it('only names scope lines the package has', () => {
    const r = reviewQuoteRead(
      out({
        lines: [line({ scopeKey: 'roof' })],
        exclusions: [
          {
            page: 2,
            snippet: 'Scaffolding above 2 m',
            text: 'Scaffolding above 2 m',
            scopeKey: 'wall',
          },
          {
            page: 2,
            snippet: 'Scaffolding above 2 m',
            text: 'Scaffolding, all levels',
            scopeKey: 'ghost',
          },
        ],
      }),
      SCOPE,
      PAGES,
    );
    expect(r.lines[0]!.scopeKey).toBeNull();
    expect(r.exclusions.map((e) => e.scopeKey)).toEqual(['wall', null]);
  });

  it('keeps an exclusion whose words cannot be found, but says so, and drops repeats', () => {
    const r = reviewQuoteRead(
      out({
        exclusions: [
          {
            page: 2,
            snippet: 'Scaffolding above 2 m',
            text: 'Scaffolding above 2 m',
            scopeKey: null,
          },
          {
            page: 2,
            snippet: 'Scaffolding above 2 m',
            text: 'scaffolding above 2 m',
            scopeKey: null,
          },
          {
            page: 1,
            snippet: 'Everything is excluded',
            text: 'Everything is excluded',
            scopeKey: null,
          },
        ],
      }),
      SCOPE,
      PAGES,
    );
    expect(r.exclusions.map((e) => [e.text, e.warning])).toEqual([
      ['Scaffolding above 2 m', null],
      ['Everything is excluded', 'source_not_found'],
    ]);
    expect(r.dropped).toBe(1);
  });

  it('cleans quantity, unit, rate and the dates and references it passes on', () => {
    const r = reviewQuoteRead(
      out({
        reference: '  TS-2291  ',
        validUntil: '2026-02-30',
        lines: [line({ quantity: '1,200', unit: null, rate: 'TBC' })],
      }),
      SCOPE,
      PAGES,
    );
    expect(r).toMatchObject({ reference: 'TS-2291', validUntil: null });
    expect(r.lines[0]).toMatchObject({ quantity: '1200', unit: 'item', rate: null });
    expect(reviewQuoteRead(out({ validUntil: '30/04/2026' }), SCOPE, PAGES).validUntil).toBeNull();
    expect(reviewQuoteRead(out({ reference: null }), SCOPE, PAGES).reference).toBeNull();
  });

  it('marks provisional sums', () => {
    const r = reviewQuoteRead(out({ lines: [line({ provisional: true })] }), SCOPE, PAGES);
    expect(r.lines[0]!.isProvisional).toBe(true);
  });
});
