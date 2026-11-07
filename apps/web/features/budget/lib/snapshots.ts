import type { BudgetSnapshot } from '../data/api';

type SnapLine = BudgetSnapshot['lines'][number];

const cents = (v: string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

export interface CompareRow {
  costCodeId: string;
  code: string;
  codeDescription: string;
  /** Revised amount in each snapshot; null when the cost code was not in that snapshot. */
  a: string | null;
  b: string | null;
  change: string;
  status: 'added' | 'removed' | 'changed' | 'same';
}

/** Line-by-line difference between two snapshots, by cost code. `a` is the earlier snapshot, `b` the later. */
export function compareSnapshots(a: BudgetSnapshot, b: BudgetSnapshot): CompareRow[] {
  const byCode = new Map<string, { a?: SnapLine; b?: SnapLine }>();
  for (const l of a.lines) byCode.set(l.costCodeId, { a: l });
  for (const l of b.lines) byCode.set(l.costCodeId, { ...byCode.get(l.costCodeId), b: l });
  return [...byCode.entries()]
    .map(([costCodeId, { a: la, b: lb }]) => {
      const ca = la ? cents(la.revised) : 0;
      const cb = lb ? cents(lb.revised) : 0;
      const ref = (lb ?? la)!;
      const status: CompareRow['status'] = !la
        ? 'added'
        : !lb
          ? 'removed'
          : ca === cb
            ? 'same'
            : 'changed';
      return {
        costCodeId,
        code: ref.code,
        codeDescription: ref.codeDescription,
        a: la?.revised ?? null,
        b: lb?.revised ?? null,
        change: fromCents(cb - ca),
        status,
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
}

export interface TrendPoint {
  id: string;
  name: string;
  takenAt: string;
  revised: number;
}

/** Revised total per snapshot, oldest first, for the trend. */
export function trendPoints(snapshots: readonly BudgetSnapshot[]): TrendPoint[] {
  return [...snapshots]
    .sort((x, y) => x.takenAt.localeCompare(y.takenAt))
    .map((s) => ({
      id: s.id,
      name: s.name,
      takenAt: s.takenAt,
      revised: Number(s.totals.revised),
    }));
}
