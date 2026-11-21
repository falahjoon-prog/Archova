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
/** Below this the model is guessing; the item is noise, not a suggestion for a person to review. */
export const MIN_CONFIDENCE = 0.1;
/** Marks this close to the sheet edge are usually the border or title block, not the plan. */
const EDGE_MARGIN = 0.012;
/** A region covering more of the sheet than this is probably the sheet border, not a room or slab. */
const WHOLE_SHEET = 0.85;
/** A run shorter than this (page fraction) has no length worth measuring. */
const MIN_RUN = 0.002;
/** Two outlines or runs whose points all lie this close to each other are the same thing drawn twice. */
const SAME_LINE = 0.004;
/** Doubtful items carry at most this confidence. */
export const DOUBT_CAP = 0.5;
const MIN_POINTS: Record<TakeoffTargetKind, number> = { count: 1, length: 2, area: 3 };
const MAX_POINTS: Record<TakeoffTargetKind, number> = { count: 1, length: 60, area: 60 };

type P = { x: number; y: number };
const onSheet = (v: number) => Number.isFinite(v) && v >= 0 && v <= 1;
const round = (v: number) => Math.round(v * 10000) / 10000;
const same = (a: P, b: P, tol = 1e-4) => Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;

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

function runLength(points: readonly P[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

function distToSegment(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Distance from a point to a polyline (closed when `closed`). */
function distToLine(p: P, line: readonly P[], closed: boolean): number {
  let best = Infinity;
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++)
    best = Math.min(best, distToSegment(p, line[i]!, line[(i + 1) % line.length]!));
  return best;
}

/** Points along a polyline, so a long straight segment between two corners is checked in the middle too. */
function sampled(line: readonly P[], closed: boolean): P[] {
  const out: P[] = [];
  const n = closed ? line.length : line.length - 1;
  for (let i = 0; i < n; i++) {
    const a = line[i]!;
    const b = line[(i + 1) % line.length]!;
    for (let k = 0; k < 5; k++)
      out.push({ x: a.x + ((b.x - a.x) * k) / 5, y: a.y + ((b.y - a.y) * k) / 5 });
  }
  out.push(line[closed ? 0 : line.length - 1]!);
  return out;
}

/** True when every point of `a` lies on `b`'s line: `a` adds nothing `b` does not already show. */
function liesOn(a: readonly P[], b: readonly P[], closed: boolean): boolean {
  return sampled(a, closed).every((p) => distToLine(p, b, closed) <= SAME_LINE);
}

const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Do segments ab and cd cross each other (not merely touch at an end)? */
function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < -1e-12 && d3 * d4 < -1e-12;
}

/** A bow-tie outline: its edges cross, so the area it encloses is not what the person would draw. */
export function selfIntersects(points: readonly P[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      // Edges that share a corner cannot cross.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(points[i]!, points[(i + 1) % n]!, points[j]!, points[(j + 1) % n]!))
        return true;
    }
  return false;
}

/** Cleans a traced line: repeated points go, and on an outline so do corners that are not corners (collinear). */
function tidy(points: P[], kind: TakeoffTargetKind): P[] {
  if (kind === 'count') return points;
  let out = points.filter((p, i) => i === 0 || !same(p, points[i - 1]!));
  if (kind === 'area') {
    // An outline repeating its first point is closed already.
    if (out.length > 3 && same(out[0]!, out[out.length - 1]!)) out = out.slice(0, -1);
    const kept = out.filter((p, i) => {
      const prev = out[(i + out.length - 1) % out.length]!;
      const next = out[(i + 1) % out.length]!;
      return Math.abs(cross(prev, p, next)) > 1e-9;
    });
    // Dropping straight-through points must not leave less than a region; the span check then rejects a flat one.
    if (kept.length >= 3) out = kept;
  }
  return out;
}

/** Notes a limit on an item: confidence is capped and the reason added unless the model already gave one. */
function doubt(item: FoundItem, cap: number, why: string) {
  item.confidence = Math.min(item.confidence, cap);
  if (!item.note) item.note = why;
}

export function reviewDetection(
  output: TakeoffDetectOutput,
  kind: TakeoffTargetKind,
  opts: { scanned: boolean },
): ReviewedDetection {
  const kept: FoundItem[] = [];
  let dropped = 0;
  for (const raw of output.items.slice(0, MAX_TAKEOFF_ITEMS)) {
    let points = tidy(
      raw.points.map((p) => ({ x: p.x, y: p.y })),
      kind,
    );
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
      Number.isFinite(raw.confidence) &&
      raw.confidence >= MIN_CONFIDENCE &&
      points.length >= MIN_POINTS[kind] &&
      points.length <= MAX_POINTS[kind] &&
      points.every((p) => onSheet(p.x) && onSheet(p.y)) &&
      (kind !== 'area' || (polygonSpan(points) > 1e-6 && !selfIntersects(points))) &&
      (kind !== 'length' || runLength(points) >= MIN_RUN);
    if (!fits) {
      dropped++;
      continue;
    }
    const item: FoundItem = {
      place: raw.place,
      points: points.map((p) => ({ x: round(p.x), y: round(p.y) })),
      confidence: opts.scanned ? Math.min(raw.confidence, RASTER_CONFIDENCE_CAP) : raw.confidence,
      note: raw.note,
    };
    if (
      kind === 'count' &&
      (points[0]!.x < EDGE_MARGIN ||
        points[0]!.x > 1 - EDGE_MARGIN ||
        points[0]!.y < EDGE_MARGIN ||
        points[0]!.y > 1 - EDGE_MARGIN)
    )
      doubt(item, DOUBT_CAP, 'On the sheet border: may be part of the frame, not the plan');
    if (kind === 'area' && polygonSpan(points) >= WHOLE_SHEET)
      doubt(item, DOUBT_CAP, 'Outline covers nearly the whole sheet: may be the border');

    // The same thing reported twice: keep the more confident report, or the fuller run, and drop the other.
    const twin = kept.findIndex((k) => isRepeat(kind, k.points, item.points));
    if (twin >= 0) {
      dropped++;
      const k = kept[twin]!;
      if (
        kind === 'length'
          ? runLength(item.points) > runLength(k.points)
          : item.confidence > k.confidence
      )
        kept[twin] = item;
      continue;
    }
    kept.push(item);
  }
  return { items: kept, caveat: output.caveat, dropped };
}

/** Is `b` the thing `a` already shows: the same symbol spot, the same run, or the same outline drawn again? */
function isRepeat(kind: TakeoffTargetKind, a: readonly P[], b: readonly P[]): boolean {
  if (kind === 'count')
    return Math.abs(a[0]!.x - b[0]!.x) < SAME_SPOT && Math.abs(a[0]!.y - b[0]!.y) < SAME_SPOT;
  if (kind === 'length') return liesOn(b, a, false) || liesOn(a, b, false);
  // Outlines: the same region, whatever corner it starts from or way it winds. A room inside another is not a repeat.
  const sa = polygonSpan(a);
  const sb = polygonSpan(b);
  return Math.abs(sa - sb) <= 0.1 * Math.max(sa, sb) && liesOn(a, b, true) && liesOn(b, a, true);
}
