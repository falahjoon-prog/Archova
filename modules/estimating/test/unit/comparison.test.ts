import { describe, expect, it } from 'vitest';
import {
  OUTLIER_MIN_CENTS,
  compareQuotes,
  deviationOf,
  median,
  type CompareQuote,
  type CompareScopeLine,
} from '../../src/domain/comparison';
import { lowestQuote } from '../../src/domain/tender';

const scope: CompareScopeLine[] = [
  { key: 'demolition', description: 'Demolition and strip-out', quantity: '1', unit: 'item' },
  { key: 'framing', description: 'Wall framing', quantity: '420', unit: 'm2' },
  { key: 'lining', description: 'Plasterboard lining', quantity: '840', unit: 'm2' },
];

let seq = 0;
function quote(
  id: string,
  lines: Array<[key: string | null, amount: string, provisional?: boolean]>,
  extra: Partial<CompareQuote> = {},
): CompareQuote {
  const total = lines.reduce((n, [, a]) => n + Math.round(Number(a) * 100), 0) / 100;
  seq += 1;
  return {
    id,
    companyId: `co-${id}`,
    revision: 1,
    status: 'confirmed',
    reference: `Q-${id}`,
    receivedAt: new Date(Date.UTC(2026, 9, 1, 0, seq)),
    validUntil: null,
    totalExGst: total.toFixed(2),
    lines: lines.map(([scopeKey, amount, isProvisional], n) => ({
      id: `${id}-l${n}`,
      scopeKey,
      amount,
      isProvisional: isProvisional ?? false,
    })),
    exclusions: [],
    qualifications: [],
    ...extra,
  };
}
const cell = (c: ReturnType<typeof compareQuotes>, key: string, quoteId: string) =>
  c.rows.find((r) => r.key === key)!.cells.find((x) => x.quoteId === quoteId)!;

describe('median and deviationOf', () => {
  it('takes the middle price, or the cent-rounded mean of the two in the middle', () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([100, 200, 300, 400])).toBe(250);
    expect(median([100, 201])).toBe(151);
  });

  it('flags a price more than 25% from the median and at least $500 away, and nothing else', () => {
    const mid = 1_000_000; // $10,000
    expect(deviationOf(1_250_000, mid)).toBeNull(); // exactly 25%
    expect(deviationOf(1_250_001, mid)).toBe('high');
    expect(deviationOf(749_999, mid)).toBe('low');
    expect(deviationOf(750_000, mid)).toBeNull();
    // 50% out, but only $100 away.
    expect(deviationOf(30_000, 20_000)).toBeNull();
    expect(deviationOf(20_000 + OUTLIER_MIN_CENTS + 40_000, 20_000)).toBe('high');
    expect(deviationOf(100, 0)).toBeNull();
    expect(deviationOf(100, -50)).toBeNull();
  });
});

describe('compareQuotes (EST-AC6)', () => {
  const a = quote('a', [
    ['demolition', '8000.00'],
    ['framing', '42000.00'],
    ['lining', '63000.00'],
  ]);
  const b = quote('b', [
    ['demolition', '9000.00'],
    ['framing', '44000.00'],
    ['lining', '61000.00'],
  ]);
  const c = quote('c', [
    ['demolition', '8500.00'],
    ['framing', '70000.00'],
    ['lining', '62000.00'],
  ]);

  it('lays out a column for each confirmed quote and a row for each scope line, with the median price', () => {
    const r = compareQuotes({ scope, quotes: [a, b, c], allowances: {}, today: '2026-10-28' });
    expect(r.columns.map((x) => x.quoteId)).toEqual(['a', 'b', 'c']);
    expect(r.rows.map((x) => x.key)).toEqual(['demolition', 'framing', 'lining']);
    expect(r.rows.map((x) => x.medianExGst)).toEqual(['8500.00', '44000.00', '62000.00']);
    expect(cell(r, 'framing', 'b')).toEqual({
      quoteId: 'b',
      state: 'priced',
      amountExGst: '44000.00',
      allowanceExGst: null,
      excluded: false,
      deviation: null,
    });
    expect(r.columns.map((x) => x.totalExGst)).toEqual(['113000.00', '114000.00', '140500.00']);
    // The lowest is marked, by the same rule the award uses.
    expect(r.columns.map((x) => x.isLowest)).toEqual([true, false, false]);
    expect(lowestQuote([a, b, c], {})).toBe('a');
  });

  it('flags a line priced far above the median, and the quote it is in', () => {
    const r = compareQuotes({ scope, quotes: [a, b, c], allowances: {}, today: '2026-10-28' });
    expect(cell(r, 'framing', 'c').deviation).toBe('high');
    expect(cell(r, 'framing', 'a').deviation).toBeNull();
    expect(r.columns.map((x) => x.outlierLines)).toEqual([0, 0, 1]);
    // Totals 113,000 / 114,000 / 140,500: median 114,000, and 140,500 is 23% above it.
    expect(r.medianTotalExGst).toBe('114000.00');
    expect(r.columns.map((x) => x.deviation)).toEqual([null, null, null]);
  });

  it('flags a total far from the median of the levelled totals', () => {
    const d = quote('d', [['framing', '60000.00']]);
    const r = compareQuotes({ scope, quotes: [a, b, d], allowances: {}, today: '2026-10-28' });
    expect(r.medianTotalExGst).toBe('113000.00');
    expect(r.columns.find((x) => x.quoteId === 'd')!.deviation).toBe('low');
    // Allowances level the gaps first: add what d left out and it is back among the others.
    const levelled = compareQuotes({
      scope,
      quotes: [a, b, d],
      allowances: { 'd:demolition': '8000.00', 'd:lining': '62000.00' },
      today: '2026-10-28',
    });
    const dc = levelled.columns.find((x) => x.quoteId === 'd')!;
    expect(dc.allowancesExGst).toBe('70000.00');
    expect(dc.levelledTotalExGst).toBe('130000.00');
    expect(dc.deviation).toBeNull();
    expect(levelled.medianTotalExGst).toBe('114000.00');
  });

  it('says a line is missing, lists it, and shows the estimator’s allowance for it', () => {
    const gap = quote('g', [
      ['demolition', '8000.00'],
      ['lining', '60000.00'],
    ]);
    const r = compareQuotes({
      scope,
      quotes: [a, gap],
      allowances: { 'g:framing': '41000.00', 'a:demolition': '500.00' },
      today: '2026-10-28',
    });
    expect(cell(r, 'framing', 'g')).toMatchObject({
      state: 'missing',
      amountExGst: null,
      allowanceExGst: '41000.00',
    });
    expect(cell(r, 'demolition', 'a').allowanceExGst).toBe('500.00');
    const gc = r.columns.find((x) => x.quoteId === 'g')!;
    expect(gc.missingScopeKeys).toEqual(['framing']);
    expect(gc.totalExGst).toBe('68000.00');
    expect(gc.levelledTotalExGst).toBe('109000.00');
    // a: 113,000 + 500 = 113,500; g levelled: 109,000, so g is lowest only because of its allowance.
    expect(r.columns.map((x) => [x.quoteId, x.isLowest])).toEqual([
      ['a', false],
      ['g', true],
    ]);
    expect(r.columns.find((x) => x.quoteId === 'a')!.missingScopeKeys).toEqual([]);
    // Two prices on the framing line is too few for a median.
    expect(r.rows[1]!.medianExGst).toBeNull();
    expect(r.medianTotalExGst).toBeNull();
  });

  it('adds up several lines for one scope line, and calls the cell provisional if any of them is', () => {
    const q = quote('p', [
      ['framing', '30000.00'],
      ['framing', '5000.00', true],
      ['lining', '60000.00'],
      [null, '1200.00'],
      ['nonexistent', '300.00'],
    ]);
    const r = compareQuotes({ scope, quotes: [q], allowances: {}, today: '2026-10-28' });
    expect(cell(r, 'framing', 'p')).toMatchObject({
      state: 'provisional',
      amountExGst: '35000.00',
    });
    expect(cell(r, 'lining', 'p').state).toBe('priced');
    expect(cell(r, 'demolition', 'p').state).toBe('missing');
    const col = r.columns[0]!;
    expect(col).toMatchObject({
      provisionalExGst: '5000.00',
      provisionalLines: 1,
      unmappedLines: 2,
      unmappedExGst: '1500.00',
      missingScopeKeys: ['demolition'],
      totalExGst: '96500.00',
    });
  });

  it('marks a scope line excluded when an exclusion names it, and carries the notes along', () => {
    const q = quote(
      'x',
      [
        ['demolition', '8000.00'],
        ['lining', '60000.00'],
      ],
      {
        exclusions: [
          { id: 'e1', text: 'Excludes wall framing', scopeKey: 'framing' },
          { id: 'e2', text: 'Excludes night work', scopeKey: null },
        ],
        qualifications: [{ id: 'q1', text: 'Subject to site access', scopeKey: null }],
      },
    );
    const r = compareQuotes({ scope, quotes: [q], allowances: {}, today: '2026-10-28' });
    expect(cell(r, 'framing', 'x')).toMatchObject({ state: 'missing', excluded: true });
    expect(cell(r, 'lining', 'x').excluded).toBe(false);
    expect(r.columns[0]!.exclusions.map((e) => e.id)).toEqual(['e1', 'e2']);
    expect(r.columns[0]!.qualifications.map((e) => e.id)).toEqual(['q1']);
  });

  it('says a quote has lapsed once its valid-until date has passed in the project’s local day', () => {
    const quotes = [
      quote('old', [['framing', '1.00']], { validUntil: '2026-10-27' }),
      quote('today', [['framing', '1.00']], { validUntil: '2026-10-28' }),
      quote('open', [['framing', '1.00']], { validUntil: null }),
    ];
    const r = compareQuotes({ scope, quotes, allowances: {}, today: '2026-10-28' });
    expect(r.columns.map((x) => [x.quoteId, x.validityExpired])).toEqual([
      ['old', true],
      ['today', false],
      ['open', false],
    ]);
  });

  it('compares only confirmed quotes, oldest received first', () => {
    const late = quote('late', [['framing', '1.00']]);
    const early = quote('early', [['framing', '1.00']], {
      receivedAt: new Date(Date.UTC(2026, 8, 1)),
    });
    const r = compareQuotes({
      scope,
      quotes: [
        late,
        quote('draft', [['framing', '1.00']], { status: 'ready_to_review' }),
        quote('reading', [['framing', '1.00']], { status: 'reading' }),
        quote('old', [['framing', '1.00']], { status: 'superseded' }),
        quote('no', [['framing', '1.00']], { status: 'declined' }),
        early,
      ],
      allowances: {},
      today: '2026-10-28',
    });
    expect(r.columns.map((x) => x.quoteId)).toEqual(['early', 'late']);
    expect(r.rows[0]!.cells).toHaveLength(2);
  });

  it('copes with no quotes and no scope', () => {
    expect(compareQuotes({ scope, quotes: [], allowances: {}, today: '2026-10-28' })).toEqual({
      columns: [],
      rows: scope.map((s) => ({ ...s, medianExGst: null, cells: [] })),
      medianTotalExGst: null,
    });
    const r = compareQuotes({
      scope: [],
      quotes: [quote('u', [[null, '10.00']])],
      allowances: {},
      today: '2026-10-28',
    });
    expect(r.rows).toEqual([]);
    expect(r.columns[0]).toMatchObject({ unmappedLines: 1, missingScopeKeys: [] });
  });

  it('does not flag price spread on a scope line priced by fewer than three quotes', () => {
    const r = compareQuotes({
      scope,
      quotes: [quote('s1', [['framing', '10000.00']]), quote('s2', [['framing', '90000.00']])],
      allowances: {},
      today: '2026-10-28',
    });
    expect(r.rows[1]!.cells.map((x) => x.deviation)).toEqual([null, null]);
  });
});
