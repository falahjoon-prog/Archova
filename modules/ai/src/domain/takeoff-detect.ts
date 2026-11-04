// Nova Esti assisted takeoff (ai/10 E1): code's check of what the model found. Nothing here measures; it keeps only
// shapes that fit the target kind and sit on the sheet, drops repeats, and caps confidence on scanned sheets, so a
// person reviews every mark and a doubtful one never looks certain (ai/10 §2: lower confidence for raster sheets).
import {
  MAX_TAKEOFF_ITEMS,
  type TakeoffDetectOutput,
  type TakeoffTargetKind,
} from '@archova/ai-prompts';

export interface FoundItem {
  place: string | null;
  /** Page fractions, origin top-left, as markups and pins. */
  points: Array<{ x: number; y: number }>;
  confidence: number;
  note: string | null;
}

export interface ReviewedDetection {
  items: FoundItem[];
  caveat: string | null;
  /** Items dropped because they were off the sheet, the wrong shape or a repeat. */
  dropped: number;
}

/** Confidence never exceeds this on a scanned sheet: the estimator must look at every item. */
export const RASTER_CONFIDENCE_CAP = 0.84;
/** Two counts closer than this (page fraction) are the same symbol. */
const SAME_SPOT = 0.006;
const MIN_POINTS: Record<TakeoffTargetKind, number> = { count: 1, length: 2, area: 3 };
const MAX_POINTS: Record<TakeoffTargetKind, number> = { count: 1, length: 60, area: 60 };

const onSheet = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
const round = (v: number) => Math.round(v * 10000) / 10000;

/** Shoelace area in page-fraction units; a polygon with no area (a line, a repeat of one point) is not a region. */
export function polygonSpan(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function reviewDetection(
  output: TakeoffDetectOutput,
  kind: TakeoffTargetKind,
  opts: { scanned: boolean },
): ReviewedDetection {
  const kept: FoundItem[] = [];
  let dropped = 0;
  for (const raw of output.items.slice(0, MAX_TAKEOFF_ITEMS)) {
    let points = raw.points.map((p) => ({ x: p.x, y: p.y }));
    // An area outline repeating its first point is closed already.
    if (kind === 'area' && points.length > 3) {
      const a = points[0]!;
      const z = points[points.length - 1]!;
      if (a.x === z.x && a.y === z.y) points = points.slice(0, -1);
    }
    // A count is one point; a model that sent several for one symbol means its centre.
    if (kind === 'count' && points.length > 1) {
      points = [
        {
          x: points.reduce((s, p) => s + p.x, 0) / points.length,
          y: points.reduce((s, p) => s + p.y, 0) / points.length,
        },
      ];
    }
    const fits =
      points.length >= MIN_POINTS[kind] &&
      points.length <= MAX_POINTS[kind] &&
      points.every((p) => onSheet(p.x) && onSheet(p.y)) &&
      (kind !== 'area' || polygonSpan(points) > 1e-6);
    if (!fits) {
      dropped++;
      continue;
    }
    const duplicate =
      kind === 'count' &&
      kept.some(
        (k) =>
          Math.abs(k.points[0]!.x - points[0]!.x) < SAME_SPOT &&
          Math.abs(k.points[0]!.y - points[0]!.y) < SAME_SPOT,
      );
    if (duplicate) {
      dropped++;
      continue;
    }
    const confidence = opts.scanned
      ? Math.min(raw.confidence, RASTER_CONFIDENCE_CAP)
      : raw.confidence;
    kept.push({
      place: raw.place,
      points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
      confidence: round(confidence),
      note: raw.note,
    });
  }
  return { items: kept, caveat: output.caveat, dropped };
}
