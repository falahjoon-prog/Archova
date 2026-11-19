import { describe, expect, it } from 'vitest';
import { computeSheet } from '../../src/domain/estimate';
import { planBudgetRows, rowsTotalCents, type HandoffLine } from '../../src/domain/budget-handoff';

const sec = (id: string, description: string): HandoffLine => ({
  id,
  parentId: null,
  kind: 'section',
  description,
  quantity: null,
  rate: null,
});
const item = (
  id: string,
  parentId: string | null,
  q: string | null,
  r: string | null,
): HandoffLine => ({
  id,
  parentId,
  kind: 'item',
  description: id,
  quantity: q,
  rate: r,
});
const settings = {
  contingencyPct: '5',
  marginPct: '12.5',
  marginBasis: 'markup',
  gstPct: '10',
} as const;

describe('estimate to budget rows', () => {
  const lines = [
    sec('s1', 'Slab'),
    item('a', 's1', '12.500', '3.33'),
    item('b', 's1', '10.000', '100.00'),
    sec('s2', 'Frame'),
    item('c', 's2', '3.000', '999.99'),
    sec('s3', 'Empty'),
    item('d', null, '1.000', '50.00'),
  ];
  const totals = computeSheet(lines, settings);

  it('adds up to the issued total ex GST to the cent', () => {
    const { rows, problems } = planBudgetRows(lines, totals);
    expect(problems).toEqual([]);
    expect(rowsTotalCents(rows)).toBe(BigInt(totals.totalExGst.replace('.', '')));
  });

  it('groups by section, skips empty ones, and puts loose items last', () => {
    const { rows } = planBudgetRows(lines, totals);
    expect(rows.map((r) => [r.code, r.original])).toEqual([
      ['EST-01', '1041.63'],
      ['EST-02', '2999.97'],
      ['EST-03', '50.00'],
      ['EST-CONT', totals.contingency],
      ['EST-MARGIN', totals.margin],
    ]);
    expect(rows.find((r) => r.code === 'EST-MARGIN')?.isMargin).toBe(true);
  });

  it('uses the estimator’s own codes and flags a clash', () => {
    const ok = planBudgetRows(lines, totals, { s1: '03-300', s2: '06-100' });
    expect(ok.rows.slice(0, 2).map((r) => r.code)).toEqual(['03-300', '06-100']);
    const bad = planBudgetRows(lines, totals, { s1: 'X', s2: 'X' });
    expect(bad.problems).toHaveLength(1);
  });

  it('leaves out contingency and margin when they are zero', () => {
    const t = computeSheet(lines, { ...settings, contingencyPct: '0', marginPct: '0' });
    expect(planBudgetRows(lines, t).rows.map((r) => r.code)).toEqual([
      'EST-01',
      'EST-02',
      'EST-03',
    ]);
  });
});
