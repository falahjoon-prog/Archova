// Harder synthetic sheets for the takeoff accuracy set (ai/10 §4): each draws one real-world situation the plain plan
// does not, with the known answer alongside, so rules and prompts can be checked without a live model or any client
// drawing. Seeded like `syntheticPlan`, so a name and a seed always give the same sheet.
//   double-outlets    outlets drawn as touching pairs (two complete symbols side by side)
//   square-cross      the outlet is a square with a cross; the legend says so, and a light switch is the look-alike
//   circle-bars       the outlet is a circle with two bars; a bare circle (a light point) is the look-alike
//   existing-work     new outlets are solid; existing ones are drawn dashed and are not to be counted
//   scale-50 / scale-200  A3 sheets at other scales (1 m is a different number of pixels)
//   portrait          the sheet is drawn portrait (A1 portrait), not landscape
//   partial-view      the plan runs off the edge of the sheet; only what is fully shown is measured
//   l-shaped          rooms are L shaped, so a bounding box over-measures
import { areaM2, type Pt, type SheetScale, type Shape } from '../domain/takeoff-accuracy';
import { encodePng } from '../infra/raster';
import { Canvas, rng, type SyntheticPlan } from './synthetic-plans';

export const SCENARIOS = [
  'double-outlets',
  'square-cross',
  'circle-bars',
  'existing-work',
  'scale-50',
  'scale-200',
  'portrait',
  'partial-view',
  'l-shaped',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface ScenarioPlan extends SyntheticPlan {
  scenario: Scenario;
  /** Things drawn that look like the target but are not to be counted (existing work, other symbols). */
  excluded: Shape[];
}

const PX_PER_MM = 2;

function sheetFor(s: Scenario): SheetScale {
  if (s === 'scale-50') return { widthMm: 420, heightMm: 297, scale: 50 };
  if (s === 'scale-200') return { widthMm: 420, heightMm: 297, scale: 200 };
  if (s === 'portrait') return { widthMm: 594, heightMm: 841, scale: 100 };
  return { widthMm: 841, heightMm: 594, scale: 100 };
}

const LEGENDS: Record<Scenario, string> = {
  'double-outlets':
    'GPO  double general purpose outlet (circle with cross); two together are two outlets',
  'square-cross':
    'GPO  general purpose outlet (square with cross)\nLS  light switch (plain small square)',
  'circle-bars':
    'GPO  general purpose outlet (circle with two bars)\nLP  light point (plain circle)',
  'existing-work':
    'GPO  new general purpose outlet (solid circle with cross)\nEXISTING  dashed circle: not in this scope',
  'scale-50': 'GPO  double general purpose outlet (circle with cross)\nSCALE 1:50',
  'scale-200': 'GPO  double general purpose outlet (circle with cross)\nSCALE 1:200',
  portrait: 'GPO  double general purpose outlet (circle with cross)',
  'partial-view':
    'GPO  double general purpose outlet (circle with cross)\nMATCH LINE: CONTINUED ON SHEET A-102',
  'l-shaped': 'GPO  double general purpose outlet (circle with cross)',
};

export function syntheticScenario(scenario: Scenario, seed: number): ScenarioPlan {
  const rand = rng(seed * 7919 + SCENARIOS.indexOf(scenario) + 1);
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const sheet = sheetFor(scenario);
  const W = Math.round(sheet.widthMm * PX_PER_MM);
  const H = Math.round(sheet.heightMm * PX_PER_MM);
  const cv = new Canvas(W, H);
  const frac = (x: number, y: number): Pt => ({ x: x / W, y: y / H });
  const small = W < 1000; // A3: smaller sheet, tighter margins and symbols
  const margin = small ? 80 : 160;
  const sym = small ? 5 : 7;
  const cut = scenario === 'partial-view';
  const cols = cut ? int(3, 4) : int(2, 3);
  const rows = int(2, 3);
  // A partial view is laid out as if the sheet were wider, so the last column is cut by the edge.
  const cw = Math.floor(((cut ? W * 1.25 : W) - margin * 2) / cols);
  const ch = Math.floor((H - margin * 2 - (small ? 40 : 120)) / rows);
  const gpos: Shape[] = [];
  const rooms: Shape[] = [];
  const excluded: Shape[] = [];

  const draw = {
    circleCross: (x: number, y: number, dashed = false) => {
      cv.circle(x, y, sym, dashed);
      if (!dashed) {
        cv.line({ x: x - sym, y }, { x: x + sym, y });
        cv.line({ x, y: y - sym }, { x, y: y + sym });
      }
    },
    squareCross: (x: number, y: number) => {
      cv.rect(x - sym, y - sym, x + sym, y + sym);
      cv.line({ x: x - sym, y: y - sym }, { x: x + sym, y: y + sym });
      cv.line({ x: x - sym, y: y + sym }, { x: x + sym, y: y - sym });
    },
    circleBars: (x: number, y: number) => {
      cv.circle(x, y, sym);
      cv.line({ x: x - 2, y: y - sym + 2 }, { x: x - 2, y: y + sym - 2 });
      cv.line({ x: x + 2, y: y - sym + 2 }, { x: x + 2, y: y + sym - 2 });
    },
  };
  const outlet = (x: number, y: number) => {
    if (scenario === 'square-cross') draw.squareCross(x, y);
    else if (scenario === 'circle-bars') draw.circleBars(x, y);
    else draw.circleCross(x, y);
    gpos.push({ points: [frac(x, y)] });
  };
  const apart = (x: number, y: number, min: number) =>
    [...gpos, ...excluded].every(
      (g) => Math.hypot(g.points[0]!.x * W - x, g.points[0]!.y * H - y) >= min,
    );

  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = margin + c * cw;
      const y0 = margin + r * ch;
      const x1 = x0 + cw;
      const y1 = y0 + ch;
      const clipped = x1 > W - 6;
      // L shape: the bottom-right quarter-ish is missing.
      const xm = x0 + Math.round(cw * 0.55);
      const ym = y0 + Math.round(ch * 0.55);
      const outline =
        scenario === 'l-shaped'
          ? [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: ym },
              { x: xm, y: ym },
              { x: xm, y: y1 },
              { x: x0, y: y1 },
            ]
          : [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ];
      for (let i = 0; i < outline.length; i++)
        cv.line(outline[i]!, outline[(i + 1) % outline.length]!, 2);
      if (!clipped) rooms.push({ points: outline.map((p) => frac(p.x, p.y)) });
      const clearOf = (px: number, py: number) =>
        scenario !== 'l-shaped' || px < xm + 4 || py < ym - 4;
      for (let i = 0, n = int(1, 3); i < n; i++) {
        // Outlets sit on the room's top and left walls, a clear margin from each other.
        const top = rand() < 0.5;
        const t = 0.15 + rand() * 0.6;
        const px = top ? x0 + t * cw : x0 + 12;
        const py = top ? y0 + 12 : y0 + t * ch;
        if (px > W - 20 || !apart(px, py, 34) || !clearOf(px, py)) continue;
        outlet(px, py);
        if (scenario === 'double-outlets') {
          // The partner touches the first, drawn along the wall.
          const qx = top ? px + sym * 2 + 2 : px;
          const qy = top ? py : py + sym * 2 + 2;
          if (qx < W - 20 && clearOf(qx, qy)) outlet(qx, qy);
        }
      }
      if (scenario === 'existing-work' && rand() < 0.8) {
        const ex = x0 + 20 + rand() * (cw - 40);
        const ey = y1 - 14;
        if (ex < W - 20 && apart(ex, ey, 34) && clearOf(ex, ey)) {
          draw.circleCross(ex, ey, true);
          excluded.push({ points: [frac(ex, ey)] });
        }
      }
      if (rand() < 0.7) {
        // The look-alike each legend names as not the target.
        const sx = x0 + 40 + rand() * (cw - 80);
        const sy = y0 + 40 + rand() * (ch - 80);
        if (sx < W - 20 && clearOf(sx, sy) && apart(sx, sy, 34)) {
          if (scenario === 'circle-bars') cv.circle(sx, sy, sym);
          else cv.rect(sx - 4, sy - 4, sx + 4, sy + 4, 2);
          excluded.push({ points: [frac(sx, sy)] });
        }
      }
    }
  const fy = H - (small ? 40 : 90);
  const fx0 = margin;
  const fx1 = W - margin;
  cv.line({ x: fx0, y: fy }, { x: fx1, y: fy }, small ? 2 : 4);
  return {
    seed,
    scenario,
    base64: Buffer.from(encodePng({ width: W, height: H, data: cv.data })).toString('base64'),
    sheet,
    legend: `${LEGENDS[scenario]}\nSF1  strip footing (heavy line)`,
    gpos,
    rooms,
    footings: [{ points: [frac(fx0, fy), frac(fx1, fy)] }],
    distractors: excluded.length,
    excluded,
  };
}

/** A set of floor plans for one building: each level is its own sheet with its own answer; totals sum the levels. */
export interface StoreySet {
  levels: Array<{ label: string; plan: SyntheticPlan }>;
  totalGpos: number;
  totalRoomAreaM2: number;
}

export function syntheticStoreys(
  seed: number,
  count: number,
  make: (seed: number) => SyntheticPlan,
): StoreySet {
  const levels = Array.from({ length: count }, (_, i) => ({
    label: i === 0 ? 'Ground Floor Plan' : `Level ${i} Floor Plan`,
    plan: make(seed * 100 + i),
  }));
  return {
    levels,
    totalGpos: levels.reduce((n, l) => n + l.plan.gpos.length, 0),
    totalRoomAreaM2: levels.reduce(
      (sum, l) => sum + l.plan.rooms.reduce((s, r) => s + areaM2(r.points, l.plan.sheet), 0),
      0,
    ),
  };
}
