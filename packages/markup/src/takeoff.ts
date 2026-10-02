// Takeoff geometry (frontend 07 §3, X30): length, area with deductions, perimeter, count, scale and snapping.
// Shared by web, mobile and the server, which recomputes quantities on save (the server value is stored).
//
// Geometry is stored in normalised sheet coordinates (0..1 on both axes, origin top-left), as every other markup.
// Normalised x and y are different paper lengths on a non-square sheet, so every calculation first converts to
// paper millimetres with the sheet's size, then to real metres with the drawing scale (1:N).

import type { Point } from './index';

/** Paper size of the sheet in millimetres (A1 landscape is 841 × 594). */
export interface SheetSize {
  widthMm: number;
  heightMm: number;
}

/** Drawing scale as the denominator N of "1:N". */
export type ScaleRatio = number;

export const TAKEOFF_KINDS = ['length', 'area', 'count'] as const;
export type TakeoffKind = (typeof TAKEOFF_KINDS)[number];
export type TakeoffUnit = 'm' | 'm2' | 'ea';

export const UNIT_FOR_KIND: Record<TakeoffKind, TakeoffUnit> = {
  length: 'm',
  area: 'm2',
  count: 'ea',
};

/** Takeoff geometry: a polyline, a polygon with optional cut-outs, or count markers. */
export type TakeoffGeometry =
  | { kind: 'length'; points: Point[] }
  | { kind: 'area'; outer: Point[]; holes: Point[][] }
  | { kind: 'count'; points: Point[] };

/** Common AU drawing scales offered in "set scale". */
export const STANDARD_SCALES: readonly ScaleRatio[] = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000,
];

/** Parses "1:100", "1 : 100" or "100" into 100. Returns null for anything else. */
export function parseScale(text: string): ScaleRatio | null {
  const m = /^\s*(?:1\s*:\s*)?(\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function formatScale(ratio: ScaleRatio): string {
  return `1:${Number.isInteger(ratio) ? ratio : ratio.toFixed(2)}`;
}

const toMm = (p: Point, sheet: SheetSize) => ({ x: p.x * sheet.widthMm, y: p.y * sheet.heightMm });

/** Distance on paper between two normalised points, in millimetres. */
export function paperDistanceMm(a: Point, b: Point, sheet: SheetSize): number {
  const pa = toMm(a, sheet);
  const pb = toMm(b, sheet);
  return Math.hypot(pb.x - pa.x, pb.y - pa.y);
}

/** Real-world length in metres of a polyline. */
export function polylineLengthM(
  points: readonly Point[],
  sheet: SheetSize,
  scale: ScaleRatio,
): number {
  let mm = 0;
  for (let i = 1; i < points.length; i++) mm += paperDistanceMm(points[i - 1]!, points[i]!, sheet);
  return (mm * scale) / 1000;
}

/** Perimeter in metres of a closed polygon. */
export function perimeterM(points: readonly Point[], sheet: SheetSize, scale: ScaleRatio): number {
  if (points.length < 2) return 0;
  return polylineLengthM([...points, points[0]!], sheet, scale);
}

/** Unsigned polygon area in square metres (shoelace formula on paper millimetres). */
export function polygonAreaM2(
  points: readonly Point[],
  sheet: SheetSize,
  scale: ScaleRatio,
): number {
  if (points.length < 3) return 0;
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = toMm(points[i]!, sheet);
    const b = toMm(points[(i + 1) % points.length]!, sheet);
    twice += a.x * b.y - b.x * a.y;
  }
  const paperMm2 = Math.abs(twice) / 2;
  return (paperMm2 * scale * scale) / 1_000_000;
}

/** Area of the outer polygon less its cut-outs (deductions), never below zero. */
export function areaWithDeductionsM2(
  outer: readonly Point[],
  holes: readonly (readonly Point[])[],
  sheet: SheetSize,
  scale: ScaleRatio,
): number {
  const gross = polygonAreaM2(outer, sheet, scale);
  const deducted = holes.reduce((sum, h) => sum + polygonAreaM2(h, sheet, scale), 0);
  return Math.max(0, gross - deducted);
}

/** The quantity of a takeoff in its unit (m, m², each). */
export function takeoffQuantity(
  geometry: TakeoffGeometry,
  sheet: SheetSize,
  scale: ScaleRatio,
): number {
  switch (geometry.kind) {
    case 'length':
      return polylineLengthM(geometry.points, sheet, scale);
    case 'area':
      return areaWithDeductionsM2(geometry.outer, geometry.holes, sheet, scale);
    case 'count':
      return geometry.points.length;
  }
}

/**
 * Two-point calibration: the user draws a line over a known dimension and types its real length. Returns the
 * scale denominator that makes the line that long.
 */
export function calibrateScale(
  a: Point,
  b: Point,
  knownLengthM: number,
  sheet: SheetSize,
): ScaleRatio {
  const mm = paperDistanceMm(a, b, sheet);
  if (mm <= 0 || !(knownLengthM > 0))
    throw new RangeError('Calibration needs two distinct points and a positive length');
  return (knownLengthM * 1000) / mm;
}

/** Rounds a quantity for display and export: metres and m² to 2 decimals, counts to whole numbers. */
export function roundQuantity(quantity: number, unit: TakeoffUnit): number {
  return unit === 'ea' ? Math.round(quantity) : Math.round(quantity * 100) / 100;
}

export function formatQuantity(quantity: number, unit: TakeoffUnit): string {
  const n = roundQuantity(quantity, unit);
  const text = n.toLocaleString('en-AU', {
    minimumFractionDigits: unit === 'ea' ? 0 : 2,
    maximumFractionDigits: unit === 'ea' ? 0 : 2,
  });
  return unit === 'm2' ? `${text} m²` : unit === 'm' ? `${text} m` : `${text} ea`;
}

// ---------------------------------------------------------------------------------------------------------------
// Snapping. The sheet's vector geometry (line segments in normalised coordinates) is indexed in a uniform grid so
// each pointer move only checks the segments near the cursor. On the web this runs in a Web Worker (frontend 07 §3).

export interface Segment {
  a: Point;
  b: Point;
}

export type SnapKind = 'endpoint' | 'midpoint' | 'edge';

export interface SnapResult {
  point: Point;
  kind: SnapKind;
  /** Distance from the cursor in normalised units. */
  distance: number;
}

export interface SnapIndex {
  readonly cellSize: number;
  readonly cells: ReadonlyMap<string, readonly number[]>;
  readonly segments: readonly Segment[];
}

const cellKey = (cx: number, cy: number) => `${cx},${cy}`;

/** Builds the grid index. `cellSize` is in normalised units; 0.02 suits A1 sheets with thousands of lines. */
export function buildSnapIndex(segments: readonly Segment[], cellSize = 0.02): SnapIndex {
  const cells = new Map<string, number[]>();
  segments.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a.x, s.b.x) / cellSize);
    const x1 = Math.floor(Math.max(s.a.x, s.b.x) / cellSize);
    const y0 = Math.floor(Math.min(s.a.y, s.b.y) / cellSize);
    const y1 = Math.floor(Math.max(s.a.y, s.b.y) / cellSize);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const key = cellKey(cx, cy);
        const list = cells.get(key);
        if (list) list.push(i);
        else cells.set(key, [i]);
      }
    }
  });
  return { cellSize, cells, segments };
}

function nearestOnSegment(p: Point, s: Segment): Point {
  const dx = s.b.x - s.a.x;
  const dy = s.b.y - s.a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return s.a;
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2));
  return { x: s.a.x + t * dx, y: s.a.y + t * dy };
}

/**
 * Snaps a cursor to the nearest endpoint, then midpoint, then edge within `tolerance` (normalised units; the
 * caller converts its pixel tolerance at the current zoom). Endpoints and midpoints win over edges when both are in
 * range, because that is where people mean to click. Returns null when nothing is close.
 */
export function snapPoint(index: SnapIndex, p: Point, tolerance: number): SnapResult | null {
  const { cellSize } = index;
  const seen = new Set<number>();
  const cx0 = Math.floor((p.x - tolerance) / cellSize);
  const cx1 = Math.floor((p.x + tolerance) / cellSize);
  const cy0 = Math.floor((p.y - tolerance) / cellSize);
  const cy1 = Math.floor((p.y + tolerance) / cellSize);
  let best: SnapResult | null = null;
  const rank: Record<SnapKind, number> = { endpoint: 0, midpoint: 1, edge: 2 };
  const consider = (point: Point, kind: SnapKind) => {
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (distance > tolerance) return;
    if (
      !best ||
      rank[kind] < rank[best.kind] ||
      (rank[kind] === rank[best.kind] && distance < best.distance)
    ) {
      best = { point, kind, distance };
    }
  };
  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      for (const i of index.cells.get(cellKey(cx, cy)) ?? []) {
        if (seen.has(i)) continue;
        seen.add(i);
        const s = index.segments[i]!;
        consider(s.a, 'endpoint');
        consider(s.b, 'endpoint');
        consider({ x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, 'midpoint');
        consider(nearestOnSegment(p, s), 'edge');
      }
    }
  }
  return best;
}
