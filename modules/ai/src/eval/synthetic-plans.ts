// Synthetic floor plans with known answers for the takeoff accuracy set (ai/10 §4). Each plan is drawn from a seed, so
// the picture and its true quantities are reproducible and contain no client information: a grid of rooms, power
// points (a circle with a cross) among look-alike distractors (light switches, small squares), and a strip-footing
// run. The generator knows exactly where everything is, which is what a model's detections are scored against.
import type { Pt, SheetScale, Shape } from '../domain/takeoff-accuracy';
import { encodePng } from '../infra/raster';

export const PLAN_SHEET: SheetScale = { widthMm: 841, heightMm: 594, scale: 100 };
const W = 1682; // 2 px per paper mm: 1 px = 0.5 mm, so 1 m at 1:100 is 20 px
const H = 1188;

/** mulberry32: small seeded generator so a seed always draws the same plan. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Canvas {
  readonly data: Uint8Array;
  constructor(
    readonly w = W,
    readonly h = H,
  ) {
    this.data = new Uint8Array(w * h).fill(255);
  }
  dot(x: number, y: number, r: number) {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const px = Math.round(x + dx);
        const py = Math.round(y + dy);
        if (px >= 0 && py >= 0 && px < this.w && py < this.h && dx * dx + dy * dy <= r * r + 0.5)
          this.data[py * this.w + px] = 0;
      }
  }
  line(a: Pt, b: Pt, thick = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= n; i++)
      this.dot(a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, thick);
  }
  rect(x0: number, y0: number, x1: number, y1: number, thick = 1) {
    this.line({ x: x0, y: y0 }, { x: x1, y: y0 }, thick);
    this.line({ x: x1, y: y0 }, { x: x1, y: y1 }, thick);
    this.line({ x: x1, y: y1 }, { x: x0, y: y1 }, thick);
    this.line({ x: x0, y: y1 }, { x: x0, y: y0 }, thick);
  }
  circle(cx: number, cy: number, r: number, dashed = false) {
    for (let i = 0; i < 48; i++) {
      if (dashed && i % 4 >= 2) continue;
      const t = (i / 48) * Math.PI * 2;
      this.dot(cx + Math.cos(t) * r, cy + Math.sin(t) * r, 1);
    }
  }
}

const frac = (x: number, y: number): Pt => ({ x: x / W, y: y / H });

export interface SyntheticPlan {
  seed: number;
  /** PNG of the sheet. */
  base64: string;
  sheet: SheetScale;
  legend: string;
  /** Power points: one point each. */
  gpos: Shape[];
  /** Room outlines (area). */
  rooms: Shape[];
  /** Strip footing runs (length). */
  footings: Shape[];
  /** Look-alike symbols that are not power points. */
  distractors: number;
}

export function syntheticPlan(seed: number): SyntheticPlan {
  const rand = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const cv = new Canvas();
  const cols = int(2, 4);
  const rows = int(2, 3);
  const margin = 160;
  const cw = Math.floor((W - margin * 2) / cols);
  const ch = Math.floor((H - margin * 2 - 120) / rows);
  const rooms: Shape[] = [];
  const gpos: Shape[] = [];
  let distractors = 0;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = margin + c * cw;
      const y0 = margin + r * ch;
      const x1 = x0 + cw;
      const y1 = y0 + ch;
      cv.rect(x0, y0, x1, y1, 2);
      rooms.push({ points: [frac(x0, y0), frac(x1, y0), frac(x1, y1), frac(x0, y1)] });
      for (let i = 0, n = int(1, 4); i < n; i++) {
        // Power points sit on the room's walls, a clear margin apart.
        const wall = int(0, 3);
        const t = 0.15 + rand() * 0.7;
        const px = wall === 0 ? x0 + 12 : wall === 1 ? x1 - 12 : x0 + t * cw;
        const py = wall === 2 ? y0 + 12 : wall === 3 ? y1 - 12 : y0 + t * ch;
        if (gpos.some((g) => Math.hypot(g.points[0]!.x * W - px, g.points[0]!.y * H - py) < 30))
          continue;
        cv.circle(px, py, 7);
        cv.line({ x: px - 7, y: py }, { x: px + 7, y: py });
        cv.line({ x: px, y: py - 7 }, { x: px, y: py + 7 });
        gpos.push({ points: [frac(px, py)] });
      }
      if (rand() < 0.7) {
        // A switch: small filled square, not a power point.
        const sx = x0 + 30 + rand() * (cw - 60);
        const sy = y0 + 30 + rand() * (ch - 60);
        cv.rect(sx - 4, sy - 4, sx + 4, sy + 4, 2);
        distractors++;
      }
    }
  // One strip footing run along the plan's bottom edge, drawn heavy.
  const fy = H - 90;
  const fx0 = margin + int(0, 60);
  const fx1 = W - margin - int(0, 60);
  cv.line({ x: fx0, y: fy }, { x: fx1, y: fy }, 4);
  return {
    seed,
    base64: Buffer.from(encodePng({ width: W, height: H, data: cv.data })).toString('base64'),
    sheet: PLAN_SHEET,
    legend:
      'GPO  double general purpose outlet (circle with cross)\nLS  light switch (square)\nSF1  strip footing (heavy line)',
    gpos,
    rooms,
    footings: [{ points: [frac(fx0, fy), frac(fx1, fy)] }],
    distractors,
  };
}
