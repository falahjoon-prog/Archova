import { describe, expect, it } from 'vitest';
import {
  divisionOf,
  isWithin,
  laborProductivityCsv,
  productivityRow,
  productivityTotals,
  type CodeNode,
} from '../../src/domain/productivity';

const node = (id: string, parentId: string | null = null): CodeNode => ({
  id,
  code: id,
  description: id,
  parentId,
});
const nodes = new Map(
  [node('03'), node('03.1', '03'), node('03.1.a', '03.1'), node('04')].map((n) => [n.id, n]),
);

describe('productivityRow', () => {
  const plan = { uom: 'm2', budgetedHours: 100, budgetedQuantity: 500, quantityComplete: 250 };

  it('earns hours from percent complete and compares rates', () => {
    const r = productivityRow(node('03.1'), '03', plan, 60 * 40);
    expect(r.pctComplete).toBe(0.5);
    expect(r.earnedHours).toBe(50);
    expect(r.pctHoursUsed).toBe(0.4);
    expect(r.budgetedRate).toBe(5);
    expect(r.actualRate).toBe(6.25);
    expect(r.flagged).toBe(false);
  });

  it('flags a row whose actual rate misses the budgeted rate', () => {
    const r = productivityRow(node('03.1'), '03', plan, 60 * 80);
    expect(r.actualRate).toBe(3.125);
    expect(r.flagged).toBe(true);
  });

  it('does not flag without booked hours or a plan, and never divides by zero', () => {
    expect(productivityRow(node('a'), 'a', plan, 0)).toMatchObject({
      actualRate: null,
      flagged: false,
    });
    const noPlan = productivityRow(node('a'), 'a', null, 120);
    expect(noPlan).toMatchObject({
      timesheetHours: 2,
      budgetedHours: null,
      earnedHours: null,
      flagged: false,
    });
    const zero = productivityRow(
      node('a'),
      'a',
      { ...plan, budgetedHours: 0, budgetedQuantity: 0 },
      60,
    );
    expect(zero).toMatchObject({
      pctHoursUsed: null,
      pctComplete: null,
      budgetedRate: null,
      flagged: false,
    });
  });
});

describe('totals and tree', () => {
  it('sums hours and reports overall efficiency', () => {
    const a = productivityRow(
      node('a'),
      'a',
      { uom: 'm', budgetedHours: 10, budgetedQuantity: 10, quantityComplete: 10 },
      600,
    );
    const b = productivityRow(
      node('b'),
      'b',
      { uom: 'm', budgetedHours: 10, budgetedQuantity: 10, quantityComplete: 5 },
      300,
    );
    expect(productivityTotals([a, b])).toEqual({
      budgetedHours: 20,
      timesheetHours: 15,
      earnedHours: 15,
      pctHoursUsed: 0.75,
      efficiency: 1,
      flaggedRows: 0,
    });
  });

  it('finds the division and descendants', () => {
    expect(divisionOf(nodes, '03.1.a')).toBe('03');
    expect(divisionOf(nodes, '04')).toBe('04');
    expect(isWithin(nodes, '03.1.a', '03.1')).toBe(true);
    expect(isWithin(nodes, '03', '03.1')).toBe(false);
  });
});

describe('laborProductivityCsv', () => {
  it('writes a header and one line per row, flagging slow rows', () => {
    const plan = { uom: 'm2', budgetedHours: 100, budgetedQuantity: 500, quantityComplete: 250 };
    const slow = productivityRow(node('03.1'), '03', plan, 60 * 80);
    const csv = laborProductivityCsv([slow]).split('\r\n');
    expect(csv[0]).toContain('Cost code,Description,Timesheet hours');
    expect(csv[1]).toBe('03.1,03.1,80,80,50,50,m2,100,500,250,5,3.125,Yes');
    expect(csv[2]).toBe('');
  });

  it('quotes commas and defuses spreadsheet formulas', () => {
    const r = productivityRow(
      { id: 'a', code: '=SUM(A1)', description: 'Walls, tiled', parentId: null },
      'a',
      null,
      0,
    );
    expect(laborProductivityCsv([r]).split('\r\n')[1]).toMatch(/^'=SUM\(A1\),"Walls, tiled",0,/);
  });
});
