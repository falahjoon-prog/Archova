import { describe, expect, it } from 'vitest';
import { areaM2, lengthM } from '../../src/domain/takeoff-accuracy';
import { syntheticPlan } from '../../src/eval/synthetic-plans';

describe('synthetic plans', () => {
  it('draw the same plan from the same seed and a different one from another', () => {
    expect(syntheticPlan(7).base64).toBe(syntheticPlan(7).base64);
    expect(syntheticPlan(7).base64).not.toBe(syntheticPlan(8).base64);
  });

  it('carry truth that is on the sheet and sized plausibly', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const p = syntheticPlan(seed);
      expect(p.gpos.length).toBeGreaterThan(0);
      for (const s of [...p.gpos, ...p.rooms, ...p.footings])
        for (const pt of s.points) {
          expect(pt.x).toBeGreaterThan(0);
          expect(pt.x).toBeLessThan(1);
          expect(pt.y).toBeGreaterThan(0);
          expect(pt.y).toBeLessThan(1);
        }
      const total = p.rooms.reduce((s, r) => s + areaM2(r.points, p.sheet), 0);
      expect(total).toBeGreaterThan(50); // metres squared on a 1:100 A1 sheet
      expect(lengthM(p.footings[0]!.points, p.sheet)).toBeGreaterThan(30);
      expect(Buffer.from(p.base64, 'base64').subarray(0, 4).toString('hex')).toBe('89504e47');
    }
  });
});
