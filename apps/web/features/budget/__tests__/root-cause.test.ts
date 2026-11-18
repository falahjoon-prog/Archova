import { describe, expect, it } from 'vitest';
import type { Budget, CostCode } from '../data/api';
import { divisionOf, projectedCents, rootCause } from '../lib/rootCause';

const code = (id: string, c: string, parentId: string | null = null) =>
  ({ id, code: c, description: `D${c}`, parentId, archived: false }) as CostCode;
const codes = [
  code('d1', '03'),
  code('c1', '03-100', 'd1'),
  code('c2', '03-200', 'd1'),
  code('d2', '05'),
];
const line = (id: string, costCodeId: string, revised: string, actual: string, over = {}) =>
  ({
    id,
    costCodeId,
    code: costCodeId,
    codeDescription: costCodeId,
    description: '',
    original: revised,
    approvedChanges: '0',
    revised,
    committed: '0',
    actual,
    forecastToComplete: '0',
    isMargin: false,
    ...over,
  }) as Budget['lines'][number];

describe('rootCause', () => {
  const lines = [
    line('l1', 'c1', '1000', '1500'),
    line('l2', 'c2', '1000', '800'),
    line('l3', 'd2', '500', '600'),
    line('l4', 'd2', '500', '0', { isMargin: true }),
  ];
  it('projects the higher of committed and actual plus forecast', () => {
    expect(projectedCents({ committed: '200', actual: '100', forecastToComplete: '50' })).toBe(
      25000,
    );
  });
  it('rolls cost codes up to their top-level division', () => {
    const m = new Map(codes.map((c) => [c.id, c]));
    expect(divisionOf('c2', m)?.id).toBe('d1');
  });
  it('shows only over budget lines and adds divisions up to the total', () => {
    const r = rootCause(lines, codes, 'over');
    expect(r.totalCents).toBe(-60000);
    expect(r.divisions.map((d) => [d.id, d.cents])).toEqual([
      ['d1', -50000],
      ['d2', -10000],
    ]);
  });
  it('nets over and under budget on all, and ignores margin', () => {
    const r = rootCause(lines, codes, 'all');
    expect(r.totalCents).toBe(-40000);
    expect(r.lines).toHaveLength(3);
  });
  it('rolls the smaller codes into one node per division', () => {
    const r = rootCause(lines, codes, 'all', 1);
    expect(r.codes.filter((c) => c.level === 'other').map((c) => c.cents)).toEqual([20000, -10000]);
    expect(r.codes.reduce((n, c) => n + c.cents, 0)).toBe(r.totalCents);
  });
});
