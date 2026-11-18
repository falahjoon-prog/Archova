import { describe, expect, it } from 'vitest';
import type { BudgetSnapshot } from '../data/api';
import { compareSnapshots, trendPoints } from '../lib/snapshots';

const line = (id: string, code: string, revised: string) => ({
  costCodeId: id,
  code,
  codeDescription: code,
  description: '',
  original: revised,
  approvedChanges: '0.00',
  revised,
  isMargin: false,
});
const snap = (id: string, takenAt: string, lines: ReturnType<typeof line>[]): BudgetSnapshot => ({
  id,
  name: id,
  note: null,
  takenAt,
  lines,
  totals: {
    original: '0.00',
    approvedChanges: '0.00',
    revised: lines.reduce((n, l) => n + Number(l.revised), 0).toFixed(2),
  },
});

describe('compareSnapshots', () => {
  it('marks added, removed, changed and unchanged codes and the change in cents', () => {
    const a = snap('a', '2026-11-01T00:00:00Z', [
      line('c1', '03-100', '100.10'),
      line('c2', '05-200', '50.00'),
      line('c3', '09-000', '10.00'),
    ]);
    const b = snap('b', '2026-11-02T00:00:00Z', [
      line('c1', '03-100', '100.30'),
      line('c2', '05-200', '50.00'),
      line('c4', '11-000', '5.00'),
    ]);
    const rows = compareSnapshots(a, b);
    expect(rows.map((r) => [r.code, r.status, r.change])).toEqual([
      ['03-100', 'changed', '0.20'],
      ['05-200', 'same', '0.00'],
      ['09-000', 'removed', '-10.00'],
      ['11-000', 'added', '5.00'],
    ]);
  });
});

describe('trendPoints', () => {
  it('orders snapshots oldest first with their revised total', () => {
    const pts = trendPoints([
      snap('later', '2026-11-03T00:00:00Z', [line('c1', 'x', '300.00')]),
      snap('first', '2026-11-01T00:00:00Z', [line('c1', 'x', '100.00')]),
    ]);
    expect(pts.map((p) => [p.name, p.revised])).toEqual([
      ['first', 100],
      ['later', 300],
    ]);
  });
});
