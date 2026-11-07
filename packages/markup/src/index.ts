// Drawing markup schema and geometry (ADR-0006), shared by web, mobile and backend PDF export.

/** Markup visibility (X12): private to the author, the author's company, or the whole project. */
export const MARKUP_VISIBILITIES = ['private', 'company', 'project'] as const;
export type MarkupVisibility = (typeof MARKUP_VISIBILITIES)[number];

/** Coordinates are normalised to the sheet: 0..1 on both axes, origin top-left, independent of render size. */
export interface Point {
  x: number;
  y: number;
}

/** How a shape is drawn. Both are optional so older markups, and pins, keep drawing in the default style. */
export interface ShapeStyle {
  /** `#rrggbb`. Unset draws in the app's danger colour. */
  color?: string;
  /** In sheet units where 1.5 is the default line (a 1000-wide overlay); 0.5 to 8 in the tools. */
  strokeWidth?: number;
}

export type MarkupShape = (
  | { kind: 'pen'; points: Point[] }
  | { kind: 'line' | 'arrow'; from: Point; to: Point }
  | { kind: 'rect' | 'ellipse' | 'cloud'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string }
  | { kind: 'pin'; at: Point; entityType: string; entityId: string }
) &
  ShapeStyle;

/** Colours the markup tools offer (red first, the default). Chosen to read on a white sheet and on a site photo. */
export const MARKUP_COLORS = [
  { value: '#D92D20', label: 'Red' },
  { value: '#E8590C', label: 'Orange' },
  { value: '#F5C518', label: 'Yellow' },
  { value: '#0B5C5E', label: 'Teal' },
  { value: '#1D4ED8', label: 'Blue' },
  { value: '#111827', label: 'Black' },
] as const;

export const MARKUP_STROKE_WIDTHS = [
  { value: 1, label: 'Thin' },
  { value: 2, label: 'Medium' },
  { value: 4, label: 'Thick' },
] as const;

export const DEFAULT_STROKE_WIDTH = 1.5;

export interface Markup {
  id: string;
  sheetRevisionId: string;
  visibility: MarkupVisibility;
  shape: MarkupShape;
  strokeWidth: number;
  createdBy: string;
}

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function normalisePoint(p: Point): Point {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

export * from './takeoff';
export * from './validate';

/** Shapes below this size (a tap, not a drag) are not kept. Normalised units, so about 1% of the sheet's width. */
const MIN_EXTENT = 0.005;

/** Whether a two-point shape or a stroke is too small to mean anything, so the tool drops it. */
export function isDegenerate(shape: MarkupShape): boolean {
  switch (shape.kind) {
    case 'pen':
      return shape.points.length < 2 || extent(shape.points) < MIN_EXTENT;
    case 'line':
    case 'arrow':
    case 'rect':
    case 'ellipse':
    case 'cloud':
      return extent([shape.from, shape.to]) < MIN_EXTENT;
    case 'text':
      return shape.text.trim() === '';
    case 'pin':
      return false;
  }
}

function extent(points: readonly Point[]): number {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}

/**
 * Thins a freehand stroke (Ramer–Douglas–Peucker) so a long drag stores tens of points, not thousands.
 * `tolerance` is in normalised units; the default is under a pixel on a typical screen.
 */
export function simplifyStroke(points: readonly Point[], tolerance = 0.0015): Point[] {
  if (points.length < 3) return points.map(normalisePoint);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let max = tolerance;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i]!, points[a]!, points[b]!);
      if (d > max) {
        max = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]).map(normalisePoint);
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
