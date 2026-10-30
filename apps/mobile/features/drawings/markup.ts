// Markups on a sheet (documents DOC-US*): shapes are held as normalised 0..1 sheet coordinates, so they stay
// on the drawing at any zoom. This turns them into primitives in screen coordinates for the overlay.
import type { Markup } from '@archova/contracts';
import { pinToScreen, type Pyramid, type Viewport } from './viewport';

type Shape = Markup['shapes'][number];
type Point = { x: number; y: number };

export type Primitive =
  | { kind: 'path'; id: string; d: string; color: string; width: number; fill?: boolean }
  | { kind: 'line'; id: string; from: Point; to: Point; color: string; width: number }
  | {
      kind: 'ellipse';
      id: string;
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      color: string;
      width: number;
    }
  | { kind: 'text'; id: string; at: Point; text: string; color: string; size: number };

const DEFAULT_WIDTH = 2;
const TEXT_SIZE = 14;

const num = (n: number) => Math.round(n * 10) / 10;

/** Stroke width in screen pixels: a shape's width is in device pixels at fit, not scaled with zoom. */
const strokeOf = (s: Shape) => Math.max(1, s.strokeWidth ?? DEFAULT_WIDTH);

/** A cloud: scallops along a rectangle, the revision-cloud symbol drawings use for a changed area. */
function cloudPath(a: Point, b: Point): string {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const bottom = Math.max(a.y, b.y);
  const bump = 14;
  const edge = (from: Point, to: Point) => {
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const n = Math.max(1, Math.round(length / bump));
    const out: string[] = [];
    for (let i = 1; i <= n; i++) {
      const sx = from.x + ((to.x - from.x) * (i - 0.5)) / n;
      const sy = from.y + ((to.y - from.y) * (i - 0.5)) / n;
      // Bulge outward: the control point is pushed off the edge, away from the shape's middle.
      const nx = to.y - from.y;
      const ny = from.x - to.x;
      const norm = Math.hypot(nx, ny) || 1;
      const lift = bump * 0.6;
      out.push(
        `Q ${num(sx + (nx / norm) * lift)} ${num(sy + (ny / norm) * lift)} ${num(from.x + ((to.x - from.x) * i) / n)} ${num(from.y + ((to.y - from.y) * i) / n)}`,
      );
    }
    return out.join(' ');
  };
  const tl = { x: left, y: top };
  const tr = { x: right, y: top };
  const br = { x: right, y: bottom };
  const bl = { x: left, y: bottom };
  return `M ${num(tl.x)} ${num(tl.y)} ${edge(tl, tr)} ${edge(tr, br)} ${edge(br, bl)} ${edge(bl, tl)} Z`;
}

/** Draws one shape; returns null for one the phone cannot place (missing coordinates). */
function shapeToPrimitive(
  p: Pyramid,
  v: Viewport,
  s: Shape,
  defaultColor: string,
): Primitive | null {
  const at = (pt: { x: number; y: number }): Point => {
    const { x, y } = pinToScreen(p, v, { pinX: pt.x, pinY: pt.y });
    return { x, y };
  };
  const color = s.color ?? defaultColor;
  const width = strokeOf(s);
  switch (s.kind) {
    case 'pen': {
      const pts = (s.points ?? []).map(at);
      if (pts.length < 2) return null;
      const d = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${num(pt.x)} ${num(pt.y)}`).join(' ');
      return { kind: 'path', id: s.id, d, color, width };
    }
    case 'line': {
      if (!s.from || !s.to) return null;
      return { kind: 'line', id: s.id, from: at(s.from), to: at(s.to), color, width };
    }
    case 'arrow': {
      if (!s.from || !s.to) return null;
      const a = at(s.from);
      const b = at(s.to);
      const angle = Math.atan2(b.y - a.y, b.x - a.x);
      const head = 12;
      const wing = (turn: number) =>
        `L ${num(b.x - head * Math.cos(angle + turn))} ${num(b.y - head * Math.sin(angle + turn))}`;
      const d = `M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)} ${wing(0.4)} M ${num(b.x)} ${num(b.y)} ${wing(-0.4)}`;
      return { kind: 'path', id: s.id, d, color, width };
    }
    case 'rect': {
      if (!s.from || !s.to) return null;
      const a = at(s.from);
      const b = at(s.to);
      const d = `M ${num(a.x)} ${num(a.y)} L ${num(b.x)} ${num(a.y)} L ${num(b.x)} ${num(b.y)} L ${num(a.x)} ${num(b.y)} Z`;
      return { kind: 'path', id: s.id, d, color, width };
    }
    case 'ellipse': {
      if (!s.from || !s.to) return null;
      const a = at(s.from);
      const b = at(s.to);
      return {
        kind: 'ellipse',
        id: s.id,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        rx: Math.abs(b.x - a.x) / 2,
        ry: Math.abs(b.y - a.y) / 2,
        color,
        width,
      };
    }
    case 'cloud': {
      if (!s.from || !s.to) return null;
      return { kind: 'path', id: s.id, d: cloudPath(at(s.from), at(s.to)), color, width };
    }
    case 'text': {
      if (!s.at || !s.text) return null;
      return { kind: 'text', id: s.id, at: at(s.at), text: s.text, color, size: TEXT_SIZE };
    }
    // A pin links a markup to a record (entityType/entityId); defects already show as pins on the sheet.
    default:
      return null;
  }
}

/** Primitives for every shape of the visible markups, in screen coordinates for the current view. */
export function markupPrimitives(
  p: Pyramid,
  v: Viewport,
  markups: readonly Markup[],
  defaultColor: string,
): Primitive[] {
  return markups.flatMap((m) =>
    m.shapes.flatMap((s) => {
      const primitive = shapeToPrimitive(p, v, s, defaultColor);
      return primitive ? [primitive] : [];
    }),
  );
}

/** Whether a markup came from an older revision and needs its place checked before it is trusted (DOC-AC7). */
export function needsLocationCheck(markups: readonly Markup[]): boolean {
  return markups.some((m) => m.needsLocationCheck);
}
