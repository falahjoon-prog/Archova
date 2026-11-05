import { describe, expect, it } from 'vitest';
import {
  attention,
  normaliseColumns,
  normaliseConfig,
  orderPortfolio,
  sortRows,
  totals,
  type ProjectCounts,
  type ResultRow,
} from '../../src/domain/report';

const tool = (open: number, overdue: number, restricted = false) => ({ restricted, open, overdue });
const counts = (r: [number, number], d: [number, number], s: [number, number]): ProjectCounts => ({
  rfis: tool(...r),
  defects: tool(...d),
  submittals: tool(...s),
  claims: tool(0, 0),
  variations: tool(0, 0),
  incidents: tool(0, 0),
});

describe('columns and config', () => {
  it('puts columns in display order, drops repeats, and falls back to all', () => {
    expect(normaliseColumns(['status', 'ref', 'status', 'project'])).toEqual([
      'project',
      'ref',
      'status',
    ]);
    expect(normaliseColumns([])).toHaveLength(7);
  });

  it('dedupes project ids when normalising a config', () => {
    const c = normaliseConfig({
      source: 'rfis',
      state: 'open',
      projectIds: ['a', 'b', 'a'],
      columns: ['title'],
      overdueOnly: false,
    });
    expect(c.projectIds).toEqual(['a', 'b']);
  });
});

describe('portfolio', () => {
  const a = { name: 'Alpha', ...counts([3, 1], [2, 0], [1, 0]) };
  const b = { name: 'Bravo', ...counts([1, 0], [1, 2], [0, 0]) };
  const c = { name: 'Charlie', ...counts([5, 0], [0, 0], [0, 0]) };

  it('adds up overdue across tools', () => {
    expect(attention(a)).toBe(1);
    expect(attention(b)).toBe(2);
  });

  it('totals every project; a restricted tool carries zeros so adds nothing', () => {
    const hidden = counts([0, 0], [4, 1], [0, 0]);
    hidden.rfis.restricted = true;
    expect(totals([a, b, hidden])).toMatchObject({
      projects: 3,
      rfisOpen: 4,
      rfisOverdue: 1,
      defectsOpen: 7,
      defectsOverdue: 3,
    });
  });

  it('orders by overdue, then open, then name', () => {
    const rows = [a, b, c].map((p) => ({ ...p, attention: attention(p) }));
    expect(orderPortfolio(rows).map((p) => p.name)).toEqual(['Bravo', 'Alpha', 'Charlie']);
  });
});

describe('sortRows', () => {
  const row = (project: string, ref: string, id: string): ResultRow => ({
    id,
    projectId: 'p',
    project,
    ref,
    title: '',
    status: 'open',
    dueDate: null,
    overdue: false,
    createdAt: '2026-11-05T00:00:00.000Z',
  });

  it('sorts by project then reference, numbers numerically', () => {
    const sorted = sortRows([
      row('Zed', 'RFI-001', '1'),
      row('Alpha', 'RFI-010', '2'),
      row('Alpha', 'RFI-002', '3'),
    ]);
    expect(sorted.map((r) => r.id)).toEqual(['3', '2', '1']);
  });
});

describe('claims and variations in the portfolio', () => {
  it('counts overdue claims toward attention and totals, and ignores variations for overdue', () => {
    const p: ProjectCounts = {
      ...counts([0, 0], [0, 0], [0, 0]),
      claims: tool(3, 2),
      variations: tool(4, 0),
    };
    expect(attention(p)).toBe(2);
    expect(totals([p])).toMatchObject({
      claimsOpen: 3,
      claimsOverdue: 2,
      variationsOpen: 4,
      variationsOverdue: 0,
    });
  });
});
