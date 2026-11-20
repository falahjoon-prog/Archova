// Takeoff accuracy scoring (ai/10 §4). Compares what Nova found on a sheet with ground truth measured independently,
// in real units: counts by matched symbols (precision, recall), lengths and areas by total quantity error. Pure
// arithmetic, so the same scorer runs on synthetic sheets in CI and on pilot drawings once consent allows them.
import type { TakeoffTargetKind } from '@archova/ai-prompts';

export interface Pt {
  x: number;
  y: number;
}
export interface SheetScale {
  /** Paper size in mm (A1 landscape 841 x 594). */
  widthMm: number;
  heightMm: number;
  /** Drawing scale denominator N of 1:N. */
  scale: number;
}
export interface Shape {
  points: Pt[];
}

/** A found count within this page fraction of a true symbol is a match. */
export const MATCH_RADIUS = 0.012;

const mm = (p: Pt, s: SheetScale) => ({ x: p.x * s.widthMm, y: p.y * s.heightMm });

export function lengthM(points: readonly Pt[], s: SheetScale): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = mm(points[i - 1]!, s);
    const b = mm(points[i]!, s);
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return (total * s.scale) / 1000;
}

export function areaM2(points: readonly Pt[], s: SheetScale): number {
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = mm(points[i]!, s);
    const b = mm(points[(i + 1) % points.length]!, s);
    twice += a.x * b.y - b.x * a.y;
  }
  return ((Math.abs(twice) / 2) * s.scale * s.scale) / 1_000_000;
}

export interface DetectionAccuracy {
  /** Found items that are real, over all found (counts only; 1 when nothing found and nothing expected). */
  precision: number;
  /** Real items found, over all real. */
  recall: number;
  /** |found - true| / true of the total quantity (m, m2 or each); 0 is exact. */
  quantityError: number;
  trueQuantity: number;
  foundQuantity: number;
}

const quantityOf = (kind: TakeoffTargetKind, shapes: readonly Shape[], s: SheetScale) =>
  kind === 'count'
    ? shapes.length
    : shapes.reduce(
        (sum, sh) => sum + (kind === 'length' ? lengthM(sh.points, s) : areaM2(sh.points, s)),
        0,
      );

export function scoreDetection(
  kind: TakeoffTargetKind,
  truth: readonly Shape[],
  found: readonly Shape[],
  sheet: SheetScale,
): DetectionAccuracy {
  const trueQuantity = quantityOf(kind, truth, sheet);
  const foundQuantity = quantityOf(kind, found, sheet);
  let matched = 0;
  if (kind === 'count') {
    const free = new Set(truth.map((_, i) => i));
    for (const f of found) {
      let best = -1;
      let bestD = MATCH_RADIUS;
      for (const i of free) {
        const d = Math.hypot(
          truth[i]!.points[0]!.x - f.points[0]!.x,
          truth[i]!.points[0]!.y - f.points[0]!.y,
        );
        if (d <= bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best >= 0) {
        free.delete(best);
        matched++;
      }
    }
  } else {
    // Runs and regions have no single point to match on: judge by the total quantity found against the truth.
    matched = Math.min(trueQuantity, foundQuantity) > 0 ? Math.min(found.length, truth.length) : 0;
  }
  const precision = found.length === 0 ? (truth.length === 0 ? 1 : 0) : matched / found.length;
  const recall = truth.length === 0 ? 1 : matched / truth.length;
  const quantityError =
    trueQuantity === 0
      ? foundQuantity === 0
        ? 0
        : 1
      : Math.abs(foundQuantity - trueQuantity) / trueQuantity;
  return { precision, recall, quantityError, trueQuantity, foundQuantity };
}

/** Accuracy bars a detection set must clear before automatic takeoff is offered (ai/10 §4 phase 3 gate). */
export const ACCURACY_BARS = {
  countRecall: 0.95,
  countPrecision: 0.95,
  quantityError: 0.05,
} as const;
