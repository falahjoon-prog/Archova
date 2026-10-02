// Drawing markup schema and geometry (ADR-0006), shared by web, mobile and backend PDF export.
// Phase 0 defines the shape contract only; Felix, Mia and Ben build geometry and hit-testing in phase 1.

/** Markup visibility (X12): private to the author, the author's company, or the whole project. */
export const MARKUP_VISIBILITIES = ['private', 'company', 'project'] as const;
export type MarkupVisibility = (typeof MARKUP_VISIBILITIES)[number];

/** Coordinates are normalised to the sheet: 0..1 on both axes, origin top-left, independent of render size. */
export interface Point {
  x: number;
  y: number;
}

export type MarkupShape =
  | { kind: 'pen'; points: Point[] }
  | { kind: 'line' | 'arrow'; from: Point; to: Point }
  | { kind: 'rect' | 'ellipse' | 'cloud'; from: Point; to: Point }
  | { kind: 'text'; at: Point; text: string }
  | { kind: 'pin'; at: Point; entityType: string; entityId: string };

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
