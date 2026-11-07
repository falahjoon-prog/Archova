import { describe, expect, it } from 'vitest';
import type { Budget, DirectCost, ProjectBudgetAdjustment } from '../data/api';
import { buyoutRows, buyoutTotals, modificationsTotal, resourceRows, toCsv } from '../lib/reports';

const line = (id: string, code: string, revised: string, committed: string, isMargin = false) =>
  ({
    id,
    code,
    codeDescription: `Work ${code}`,
    revised,
    committed,
    isMargin,
  }) as Budget['lines'][number];

const cost = (
  budgetLineId: string,
  category: DirectCost['category'],
  amount: string,
  status = 'recorded',
) => ({ budgetLineId, category, amount, status }) as DirectCost;

describe('buyoutRows', () => {
  const rows = buyoutRows([
    line('c', '03', '1000.00', '1200.00'),
    line('a', '01', '1000.00', '0.00'),
    line('b', '02', '1000.00', '400.00'),
    line('d', '04', '1000.00', '1000.00'),
    line('m', '99', '500.00', '0.00', true),
  ]);

  it('orders by code, leaves margin out and classifies each line', () => {
    expect(rows.map((r) => [r.code, r.status])).toEqual([
      ['01', 'none'],
      ['02', 'partial'],
      ['03', 'over'],
      ['04', 'full'],
    ]);
  });

  it('works out uncommitted and the percentage, and totals them', () => {
    expect(rows[1]).toMatchObject({ uncommitted: '600.00', percent: 40 });
    expect(rows[2]).toMatchObject({ uncommitted: '-200.00', percent: 120 });
    expect(buyoutTotals(rows)).toEqual({
      revised: '4000.00',
      committed: '2600.00',
      uncommitted: '1400.00',
    });
  });

  it('has no percentage when the budget is zero', () => {
    expect(buyoutRows([line('z', '05', '0.00', '0.00')])[0]?.percent).toBeNull();
  });
});

describe('resourceRows', () => {
  it('sums recorded costs by type, skips voids and lines with no spend, and flags overspend', () => {
    const rows = resourceRows(
      [
        line('a', '01', '1000.00', '0'),
        line('b', '02', '300.00', '0'),
        line('c', '03', '50.00', '0'),
      ],
      [
        cost('a', 'labour', '400.10'),
        cost('a', 'labour', '100.05'),
        cost('a', 'plant', '99.85'),
        cost('a', 'materials', '5000.00', 'void'),
        cost('b', 'materials', '350.00'),
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ code: '01', spent: '600.00', percent: 60, over: false });
    expect(rows[0]?.byCategory).toEqual({
      labour: '500.15',
      materials: '0.00',
      plant: '99.85',
      fees: '0.00',
      other: '0.00',
    });
    expect(rows[1]).toMatchObject({ code: '02', spent: '350.00', over: true });
  });
});

describe('modificationsTotal', () => {
  it('adds signed amounts', () => {
    expect(
      modificationsTotal([
        { amount: '2500.75' },
        { amount: '-500.00' },
      ] as ProjectBudgetAdjustment[]),
    ).toBe('2000.75');
  });
});

describe('toCsv', () => {
  it('quotes commas and quotes, keeps negative amounts, and defuses formulas', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x,y', '-12.50'],
          ['say "hi"', '=SUM(A1)'],
          [null, '-cmd'],
        ],
      ),
    ).toBe('a,b\r\n"x,y",-12.50\r\n"say ""hi""",\'=SUM(A1)\r\n,\'-cmd\r\n');
  });
});
