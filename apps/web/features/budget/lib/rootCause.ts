import type { Budget, CostCode } from '../data/api';

type Line = Budget['lines'][number];

const cents = (v: string) => Math.round(Number(v) * 100);
const fromCents = (c: number) => (c / 100).toFixed(2);

/** Which lines count: those over budget, under budget or both. */
export type StatusFilter = 'over' | 'under' | 'all';

export interface CauseLine {
  id: string;
  code: string;
  codeDescription: string;
  divisionId: string;
  revised: string;
  projected: string;
  /** Revised budget minus projected cost, in dollars. Negative is over budget. */
  variance: string;
  varianceCents: number;
}

export interface CauseNode {
  id: string;
  level: 'division' | 'code' | 'other';
  label: string;
  /** Signed contribution to the total, in cents. Negative is over budget. */
  cents: number;
  parentId: string | null;
  lineId: string | null;
}

export interface RootCause {
  /** Net variance of the lines shown, in cents. */
  totalCents: number;
  lines: CauseLine[];
  divisions: CauseNode[];
  codes: CauseNode[];
}

/**
 * Projected cost for a line: whichever is higher of committed and actual, plus the forecast to complete. Margin lines
 * are never a cost, so they are left out.
 */
export function projectedCents(l: Pick<Line, 'committed' | 'actual' | 'forecastToComplete'>) {
  return Math.max(cents(l.committed), cents(l.actual)) + cents(l.forecastToComplete);
}

/** The top-level cost code above (or equal to) this one. Stops on a cycle. */
export function divisionOf(id: string, byId: Map<string, CostCode>): CostCode | undefined {
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    cur = parent;
  }
  return cur;
}

/**
 * Break the budget variance down: total, then division, then cost code. `maxCodes` keeps the chart readable; the rest
 * are rolled into one "Other" node per division so every division still adds up.
 */
export function rootCause(
  lines: Line[],
  codes: CostCode[],
  filter: StatusFilter,
  maxCodes = 12,
): RootCause {
  const byId = new Map(codes.map((c) => [c.id, c]));
  const all: CauseLine[] = lines
    .filter((l) => !l.isMargin)
    .map((l) => {
      const projected = projectedCents(l);
      const v = cents(l.revised) - projected;
      const div = divisionOf(l.costCodeId, byId);
      return {
        id: l.id,
        code: l.code,
        codeDescription: l.codeDescription,
        divisionId: div?.id ?? l.costCodeId,
        revised: l.revised,
        projected: fromCents(projected),
        variance: fromCents(v),
        varianceCents: v,
      };
    })
    .filter((l) =>
      filter === 'over' ? l.varianceCents < 0 : filter === 'under' ? l.varianceCents > 0 : true,
    )
    .sort((a, b) => Math.abs(b.varianceCents) - Math.abs(a.varianceCents));

  const keep = new Set(all.slice(0, maxCodes).map((l) => l.id));
  const divisionCents = new Map<string, number>();
  const codeNodes: CauseNode[] = [];
  const otherByDiv = new Map<string, { cents: number; n: number }>();
  for (const l of all) {
    divisionCents.set(l.divisionId, (divisionCents.get(l.divisionId) ?? 0) + l.varianceCents);
    if (keep.has(l.id)) {
      codeNodes.push({
        id: l.id,
        level: 'code',
        label: `${l.code} ${l.codeDescription}`,
        cents: l.varianceCents,
        parentId: l.divisionId,
        lineId: l.id,
      });
    } else {
      const o = otherByDiv.get(l.divisionId) ?? { cents: 0, n: 0 };
      otherByDiv.set(l.divisionId, { cents: o.cents + l.varianceCents, n: o.n + 1 });
    }
  }
  for (const [divId, o] of otherByDiv)
    codeNodes.push({
      id: `other_${divId}`,
      level: 'other',
      label: `${o.n} smaller code${o.n === 1 ? '' : 's'}`,
      cents: o.cents,
      parentId: divId,
      lineId: null,
    });

  const divisions: CauseNode[] = [...divisionCents.entries()]
    .map(([id, c]) => {
      const d = byId.get(id);
      return {
        id,
        level: 'division' as const,
        label: d ? `${d.code} ${d.description}` : 'Other',
        cents: c,
        parentId: null,
        lineId: null,
      };
    })
    .sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  const order = new Map(divisions.map((d, i) => [d.id, i]));
  codeNodes.sort(
    (a, b) =>
      order.get(a.parentId!)! - order.get(b.parentId!)! || Math.abs(b.cents) - Math.abs(a.cents),
  );

  return {
    totalCents: all.reduce((n, l) => n + l.varianceCents, 0),
    lines: all,
    divisions,
    codes: codeNodes,
  };
}
