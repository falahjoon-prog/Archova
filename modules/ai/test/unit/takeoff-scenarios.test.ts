import { describe, expect, it } from 'vitest';
import type { TakeoffDetectOutput } from '@archova/ai-prompts';
import { areaM2, lengthM, scoreDetection } from '../../src/domain/takeoff-accuracy';
import {
  DOUBT_CAP,
  MIN_CONFIDENCE,
  reviewDetection,
  selfIntersects,
} from '../../src/domain/takeoff-detect';
import { syntheticPlan } from '../../src/eval/synthetic-plans';
import { SCENARIOS, syntheticScenario, syntheticStoreys } from '../../src/eval/synthetic-scenarios';

const vector = { scanned: false };
const item = (points: Array<[number, number]>, confidence = 0.9, note: string | null = null) => ({
  place: null,
  points: points.map(([x, y]) => ({ x, y })),
  confidence,
  note,
});
const out = (items: TakeoffDetectOutput['items']): TakeoffDetectOutput => ({ items, caveat: null });
const nudge = (p: { x: number; y: number }, dx: number, dy: number): [number, number] => [
  p.x + dx,
  p.y + dy,
];

describe('synthetic scenarios', () => {
  it('draw the same sheet from the same seed and carry truth that is on the sheet', () => {
    for (const name of SCENARIOS) {
      const a = syntheticScenario(name, 3);
      expect(a.base64).toBe(syntheticScenario(name, 3).base64);
      expect(a.base64).not.toBe(syntheticScenario(name, 4).base64);
      expect(Buffer.from(a.base64, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
      expect(a.rooms.length).toBeGreaterThan(0);
      for (const s of [...a.gpos, ...a.rooms, ...a.footings, ...a.excluded])
        for (const pt of s.points) {
          expect(pt.x).toBeGreaterThan(0);
          expect(pt.x).toBeLessThan(1);
          expect(pt.y).toBeGreaterThan(0);
          expect(pt.y).toBeLessThan(1);
        }
    }
  });

  it('put the situation each scenario names on the sheet', () => {
    const rich = (name: (typeof SCENARIOS)[number]) =>
      [1, 2, 3, 4, 5, 6].map((seed) => syntheticScenario(name, seed));
    // Double outlets: some pair of true outlets is a symbol apart.
    expect(
      rich('double-outlets').some((p) =>
        p.gpos.some((a, i) =>
          p.gpos.some(
            (b, j) =>
              i < j &&
              Math.hypot(a.points[0]!.x - b.points[0]!.x, a.points[0]!.y - b.points[0]!.y) < 0.012,
          ),
        ),
      ),
    ).toBe(true);
    // Existing work is drawn but not in the truth.
    expect(rich('existing-work').every((p) => p.excluded.length > 0)).toBe(true);
    // L-shaped rooms have six corners and less area than their bounding box.
    for (const p of rich('l-shaped')) {
      expect(p.rooms.every((r) => r.points.length === 6)).toBe(true);
      const r = p.rooms[0]!;
      const xs = r.points.map((q) => q.x);
      const ys = r.points.map((q) => q.y);
      const box = [
        { x: Math.min(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.min(...ys) },
        { x: Math.max(...xs), y: Math.max(...ys) },
        { x: Math.min(...xs), y: Math.max(...ys) },
      ];
      expect(areaM2(r.points, p.sheet)).toBeLessThan(areaM2(box, p.sheet) * 0.9);
    }
    // Other scales and sheet shapes.
    expect(syntheticScenario('scale-50', 1).sheet.scale).toBe(50);
    expect(syntheticScenario('scale-200', 1).sheet.scale).toBe(200);
    const portrait = syntheticScenario('portrait', 1).sheet;
    expect(portrait.heightMm).toBeGreaterThan(portrait.widthMm);
    // A partial view leaves out the rooms the edge cuts off.
    for (const p of rich('partial-view')) {
      expect(p.rooms.every((r) => r.points.every((q) => q.x < 0.995))).toBe(true);
    }
  });

  it('give the same real quantity from a scale-appropriate sheet', () => {
    // Real metres follow the sheet's scale: a 1:200 A3 footing run is four times the 1:50 one for the same drawn run.
    const a = syntheticScenario('scale-50', 2);
    const b = syntheticScenario('scale-200', 2);
    expect(
      lengthM(b.footings[0]!.points, b.sheet) / lengthM(a.footings[0]!.points, a.sheet),
    ).toBeCloseTo(4, 5);
  });

  it('keep a multi-storey set as separate answers that sum', () => {
    const set = syntheticStoreys(5, 3, syntheticPlan);
    expect(set.levels).toHaveLength(3);
    expect(new Set(set.levels.map((l) => l.plan.base64)).size).toBe(3);
    expect(set.totalGpos).toBe(set.levels.reduce((n, l) => n + l.plan.gpos.length, 0));
    expect(set.totalRoomAreaM2).toBeGreaterThan(150);
  });
});

describe('detection review on messy model output', () => {
  it('counts touching double outlets as two and a model repeat as one', () => {
    const p = syntheticScenario('double-outlets', 2);
    const truth = p.gpos;
    const found = [
      ...truth.map((g) => item([nudge(g.points[0]!, 0.0008, -0.0005)], 0.9)),
      // The model reports a few of them again, slightly off.
      ...truth.slice(0, 3).map((g) => item([nudge(g.points[0]!, -0.002, 0.001)], 0.7)),
    ];
    const r = reviewDetection(out(found), 'count', vector);
    const score = scoreDetection(
      'count',
      truth,
      r.items.map((i) => ({ points: i.points })),
      p.sheet,
    );
    expect(r.items).toHaveLength(truth.length);
    expect(r.dropped).toBe(3);
    expect(score.recall).toBe(1);
    expect(score.precision).toBe(1);
  });

  it('keeps the more confident report of a repeated symbol', () => {
    const r = reviewDetection(
      out([item([[0.4, 0.4]], 0.5), item([[0.4015, 0.4]], 0.9)]),
      'count',
      vector,
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.confidence).toBe(0.9);
  });

  it('drops noise below the minimum confidence and doubts marks on the sheet border', () => {
    const r = reviewDetection(
      out([
        item([[0.3, 0.3]], MIN_CONFIDENCE - 0.05),
        item([[0.004, 0.5]], 0.95),
        item([[0.5, 0.5]], 0.95),
      ]),
      'count',
      vector,
    );
    expect(r.items).toHaveLength(2);
    expect(r.dropped).toBe(1);
    const edge = r.items.find((i) => i.points[0]!.x < 0.01)!;
    expect(edge.confidence).toBe(DOUBT_CAP);
    expect(edge.note).toMatch(/border/);
    expect(r.items.find((i) => i.points[0]!.x === 0.5)!.confidence).toBe(0.95);
  });

  it('measures an L-shaped room as drawn, not its bounding box, and ignores a repeat from another corner', () => {
    const p = syntheticScenario('l-shaped', 2);
    const room = p.rooms[0]!;
    const pts = room.points.map((q) => [q.x, q.y] as [number, number]);
    const rotated = [...pts.slice(2), ...pts.slice(0, 2)].reverse(); // other start corner and winding
    const r = reviewDetection(out([item(pts, 0.9), item(rotated, 0.8)]), 'area', vector);
    expect(r.items).toHaveLength(1);
    expect(r.dropped).toBe(1);
    const found = scoreDetection('area', [room], [{ points: r.items[0]!.points }], p.sheet);
    expect(found.quantityError).toBeLessThan(0.001);
  });

  it('keeps a room inside another room (a different region) and rooms that share a wall', () => {
    const big = [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.9],
    ] as Array<[number, number]>;
    const inner = [
      [0.3, 0.3],
      [0.5, 0.3],
      [0.5, 0.5],
      [0.3, 0.5],
    ] as Array<[number, number]>;
    const left = [
      [0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.9],
      [0.1, 0.9],
    ] as Array<[number, number]>;
    const right = [
      [0.5, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.5, 0.9],
    ] as Array<[number, number]>;
    expect(reviewDetection(out([item(big), item(inner)]), 'area', vector).items).toHaveLength(2);
    expect(reviewDetection(out([item(left), item(right)]), 'area', vector).items).toHaveLength(2);
  });

  it('drops a bow-tie outline and straightens redundant outline points', () => {
    expect(
      selfIntersects([
        { x: 0.1, y: 0.1 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: 0.1 },
        { x: 0.1, y: 0.5 },
      ]),
    ).toBe(true);
    const bow = item([
      [0.1, 0.1],
      [0.5, 0.5],
      [0.5, 0.1],
      [0.1, 0.5],
    ]);
    expect(reviewDetection(out([bow]), 'area', vector).items).toHaveLength(0);
    const padded = item([
      [0.1, 0.1],
      [0.3, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
      [0.1, 0.5],
      [0.1, 0.5],
    ]);
    expect(reviewDetection(out([padded]), 'area', vector).items[0]!.points).toHaveLength(4);
  });

  it('doubts an outline that is the whole sheet', () => {
    const r = reviewDetection(
      out([
        item(
          [
            [0.01, 0.01],
            [0.99, 0.01],
            [0.99, 0.99],
            [0.01, 0.99],
          ],
          0.95,
        ),
      ]),
      'area',
      vector,
    );
    expect(r.items[0]!.confidence).toBe(DOUBT_CAP);
    expect(r.items[0]!.note).toMatch(/whole sheet/);
  });

  it('keeps the fuller of two reports of one run, and a run that bends', () => {
    const half = item(
      [
        [0.1, 0.9],
        [0.5, 0.9],
      ],
      0.8,
    );
    const whole = item(
      [
        [0.1, 0.9],
        [0.9, 0.9],
      ],
      0.8,
    );
    const r = reviewDetection(out([half, whole]), 'length', vector);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]!.points[1]).toEqual({ x: 0.9, y: 0.9 });
    const bend = item([
      [0.1, 0.5],
      [0.1, 0.9],
      [0.9, 0.9],
    ]);
    const other = item([
      [0.1, 0.2],
      [0.9, 0.2],
    ]);
    expect(reviewDetection(out([bend, other]), 'length', vector).items).toHaveLength(2);
    expect(
      reviewDetection(
        out([
          item([
            [0.5, 0.5],
            [0.5005, 0.5],
          ]),
        ]),
        'length',
        vector,
      ).items,
    ).toHaveLength(0);
  });

  it('scores a whole synthetic scenario run clean through review', () => {
    for (const name of SCENARIOS) {
      const p = syntheticScenario(name, 9);
      // A model that finds every true room and run, plus a copy of each room, and a stray point beyond the sheet.
      const found = [
        ...p.rooms.map((r) => item(r.points.map((q) => [q.x, q.y] as [number, number]))),
        ...p.rooms.map((r) =>
          item(
            r.points.map((q) => [q.x, q.y] as [number, number]),
            0.5,
          ),
        ),
        item([
          [1.2, 0.5],
          [1.3, 0.5],
          [1.3, 0.6],
        ]),
      ];
      const r = reviewDetection(out(found), 'area', vector);
      expect(r.items).toHaveLength(p.rooms.length);
      const s = scoreDetection(
        'area',
        p.rooms,
        r.items.map((i) => ({ points: i.points })),
        p.sheet,
      );
      expect(s.quantityError).toBeLessThan(0.001);
    }
  });
});
