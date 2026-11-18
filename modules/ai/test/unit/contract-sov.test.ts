import { describe, expect, it } from 'vitest';
import type { ContractSovOutput } from '@archova/ai-prompts';
import { reviewSov } from '../../src/domain/contract-sov';

const PAGES = [
  {
    page: 1,
    text: '1.01 Preliminaries $40,000.00\n1.02 Demolition $25,000.00\nPainting $30,000.00\nTotal $95,000.00',
  },
  { page: 2, text: '2.01 Joinery supply and install $135,000.00' },
];
const line = (over: Partial<ContractSovOutput['lines'][number]> = {}) => ({
  page: 1,
  code: '1.01',
  description: 'Preliminaries',
  amount: '$40,000.00',
  quote: '1.01 Preliminaries $40,000.00',
  ...over,
});
const out = (lines: ContractSovOutput['lines']): ContractSovOutput => ({
  prices: 'exclude_gst',
  statedTotal: null,
  lines,
});

describe('schedule of values rules', () => {
  it('proposes lines found on the page and totals them by code', () => {
    const r = reviewSov(
      out([
        line(),
        line({
          code: '1.02',
          description: 'Demolition',
          amount: '$25,000.00',
          quote: '1.02 Demolition $25,000.00',
        }),
      ]),
      PAGES,
      '65000.00',
    );
    expect(r.lines).toMatchObject([
      { code: '1.01', amount: '40000.00', source: { page: 1 } },
      { code: '1.02', amount: '25000.00' },
    ]);
    expect(r).toMatchObject({
      linesTotalExGst: '65000.00',
      totalCheck: 'matches',
      difference: '0.00',
    });
  });

  it('fixes a wrong page number', () => {
    const r = reviewSov(
      out([
        line({
          page: 1,
          code: '2.01',
          description: 'Joinery supply and install',
          amount: '135000',
          quote: '2.01 Joinery supply and install $135,000.00',
        }),
      ]),
      PAGES,
      null,
    );
    expect(r.lines[0]!.source.page).toBe(2);
  });

  it('says the lines differ from the contract value and never adds a balancing line', () => {
    const r = reviewSov(out([line()]), PAGES, '50000.00');
    expect(r.lines).toHaveLength(1);
    expect(r).toMatchObject({ totalCheck: 'differs', difference: '-10000.00' });
    expect(r.warnings).toContain('total_differs');
  });

  it('drops a line whose words or amount are not on the page', () => {
    const r = reviewSov(
      out([
        line({
          quote: '9.99 Adjustment $5,000.00',
          description: 'Adjustment',
          amount: '$5,000.00',
        }),
        line({ amount: '$41,000.00' }),
        line({ amount: '-$40,000.00' }),
        line({ amount: 'about forty thousand' }),
        line({ quote: '1.01' }),
      ]),
      PAGES,
      null,
    );
    expect(r.lines).toEqual([]);
    expect(r.dropped).toBe(5);
    expect(r.warnings).toEqual(expect.arrayContaining(['no_lines', 'items_dropped']));
  });

  it('leaves the code blank when the page does not print it, and for rows with none', () => {
    const r = reviewSov(
      out([
        line({
          code: '7.7',
          description: 'Painting',
          amount: '$30,000.00',
          quote: 'Painting $30,000.00',
        }),
        line({ code: null, description: 'Preliminaries' }),
      ]),
      PAGES,
      null,
    );
    expect(r.lines.map((l) => l.code)).toEqual(['', '']);
    expect(r.totalCheck).toBe('no_value');
    expect(r.difference).toBeNull();
  });

  it('removes repeats and flags prices that include GST', () => {
    const r = reviewSov({ ...out([line(), line()]), prices: 'include_gst' }, PAGES, null);
    expect(r.lines).toHaveLength(1);
    expect(r.dropped).toBe(1);
    expect(r.warnings).toContain('prices_include_gst');
  });

  it('shows the printed total only when it is on a page', () => {
    expect(
      reviewSov({ ...out([line()]), statedTotal: '$95,000.00' }, PAGES, null).statedTotalExGst,
    ).toBe('95000.00');
    expect(
      reviewSov({ ...out([line()]), statedTotal: '$96,000.00' }, PAGES, null).statedTotalExGst,
    ).toBeNull();
  });
});
