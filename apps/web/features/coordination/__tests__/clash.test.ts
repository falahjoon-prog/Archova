import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  clashTitle,
  detectClashes,
  transformPositions,
  unionBox,
  type ModelElement,
} from '../lib/clash';

const el = (
  modelId: string,
  guid: string,
  min: [number, number, number],
  max: [number, number, number],
): ModelElement => ({
  modelId,
  expressId: 1,
  guid,
  name: guid,
  ifcType: 'IFCWALL',
  box: { min, max },
});

describe('detectClashes', () => {
  it('finds elements from different models whose bounds overlap', () => {
    const { clashes, truncated } = detectClashes([
      el('arch', 'wall', [0, 0, 0], [4, 3, 0.2]),
      el('mech', 'duct', [3, 1, -0.1], [6, 1.3, 0.1]),
    ]);
    expect(truncated).toBe(false);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.overlap[0]).toBeCloseTo(1);
    expect(clashes[0]!.depth).toBeCloseTo(0.1);
    expect(clashes[0]!.volume).toBeCloseTo(1 * 0.3 * 0.1);
  });

  it('ignores elements that only touch, or overlap less than the tolerance', () => {
    const a = el('arch', 'a', [0, 0, 0], [1, 1, 1]);
    expect(detectClashes([a, el('mech', 'b', [1, 0, 0], [2, 1, 1])]).clashes).toHaveLength(0);
    expect(detectClashes([a, el('mech', 'c', [0.998, 0, 0], [2, 1, 1])]).clashes).toHaveLength(0);
    expect(
      detectClashes([a, el('mech', 'c', [0.98, 0, 0], [2, 1, 1])], { tolerance: 0.05 }).clashes,
    ).toHaveLength(0);
  });

  it('keeps elements of one model apart unless asked', () => {
    const pair = [el('arch', 'a', [0, 0, 0], [1, 1, 1]), el('arch', 'b', [0.5, 0, 0], [2, 1, 1])];
    expect(detectClashes(pair).clashes).toHaveLength(0);
    expect(detectClashes(pair, { withinModel: true }).clashes).toHaveLength(1);
  });

  it('reports near misses when a clearance is asked for', () => {
    const pair = [el('arch', 'a', [0, 0, 0], [1, 1, 1]), el('mech', 'b', [1.1, 0, 0], [2, 1, 1])];
    expect(detectClashes(pair).clashes).toHaveLength(0);
    expect(detectClashes(pair, { clearance: 0.2 }).clashes).toHaveLength(1);
  });

  it('lists the largest overlap first and caps the list', () => {
    const list = [
      el('a', 'big', [0, 0, 0], [2, 2, 2]),
      el('b', 'big2', [0, 0, 0], [2, 2, 2]),
      el('b', 'small', [1.9, 1.9, 1.9], [3, 3, 3]),
    ];
    const all = detectClashes(list);
    expect(all.clashes[0]!.b.guid === 'big2' || all.clashes[0]!.a.guid === 'big2').toBe(true);
    const capped = detectClashes(list, { limit: 1 });
    expect(capped.clashes).toHaveLength(1);
    expect(capped.truncated).toBe(true);
  });

  it('stays correct when elements arrive unsorted', () => {
    const { clashes } = detectClashes([
      el('b', 'far', [50, 0, 0], [51, 1, 1]),
      el('a', 'x', [0, 0, 0], [1, 1, 1]),
      el('b', 'y', [0.5, 0, 0], [1.5, 1, 1]),
    ]);
    expect(clashes).toHaveLength(1);
  });
});

describe('box helpers', () => {
  it('bounds a position array and joins boxes', () => {
    const b = boundsOf([0, 0, 0, 2, 3, 4, -1, 1, 1])!;
    expect(b.min).toEqual([-1, 0, 0]);
    expect(b.max).toEqual([2, 3, 4]);
    expect(boundsOf([])).toBeNull();
    expect(unionBox(b, { min: [5, 5, 5], max: [6, 6, 6] }).max).toEqual([6, 6, 6]);
  });
  it('applies a column-major matrix', () => {
    // translate by (1, 2, 3)
    const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1];
    expect(Array.from(transformPositions([1, 1, 1], m))).toEqual([2, 3, 4]);
  });
  it('titles a clash with both elements and their models', () => {
    const [c] = detectClashes([
      el('arch', 'Wall', [0, 0, 0], [1, 1, 1]),
      el('mech', 'Duct', [0, 0, 0], [1, 1, 1]),
    ]).clashes;
    expect(clashTitle(c!, (id) => id.toUpperCase())).toMatch(/× /);
  });
});
