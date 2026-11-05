import { describe, expect, it } from 'vitest';
import { invalidShape, isDegenerate, simplifyStroke, type MarkupShape } from '../src';

const rect = (from: [number, number], to: [number, number]): MarkupShape => ({
  kind: 'rect',
  from: { x: from[0], y: from[1] },
  to: { x: to[0], y: to[1] },
});

describe('isDegenerate', () => {
  it('drops taps and empty notes but keeps real shapes', () => {
    expect(isDegenerate(rect([0.5, 0.5], [0.5, 0.5]))).toBe(true);
    expect(isDegenerate(rect([0.1, 0.1], [0.3, 0.2]))).toBe(false);
    expect(isDegenerate({ kind: 'text', at: { x: 0.2, y: 0.2 }, text: '  ' })).toBe(true);
    expect(isDegenerate({ kind: 'pen', points: [{ x: 0.2, y: 0.2 }] })).toBe(true);
    expect(
      isDegenerate({
        kind: 'pen',
        points: [
          { x: 0.2, y: 0.2 },
          { x: 0.4, y: 0.25 },
        ],
      }),
    ).toBe(false);
  });
});

describe('simplifyStroke', () => {
  it('thins a long straight drag to its ends and keeps corners', () => {
    const line = Array.from({ length: 200 }, (_, i) => ({ x: i / 199, y: 0.5 }));
    expect(simplifyStroke(line)).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
    const corner = [
      ...Array.from({ length: 50 }, (_, i) => ({ x: i / 100, y: 0.2 })),
      ...Array.from({ length: 50 }, (_, i) => ({ x: 0.5, y: 0.2 + i / 100 })),
    ];
    const out = simplifyStroke(corner);
    expect(out.length).toBeLessThan(5);
    expect(out.some((p) => Math.abs(p.x - 0.49) < 0.02 && Math.abs(p.y - 0.2) < 0.02)).toBe(true);
  });

  it('clamps points that left the sheet', () => {
    const out = simplifyStroke([
      { x: -0.2, y: 0.5 },
      { x: 1.3, y: 0.5 },
    ]);
    expect(out).toEqual([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ]);
  });
});

describe('invalidShape', () => {
  it('accepts shapes with a colour and width and rejects duplicate ids', () => {
    const a = { id: 'a', kind: 'rect', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, color: '#D92D20' };
    expect(invalidShape([a])).toBeNull();
    expect(invalidShape([a, a])).toMatchObject({ index: 1 });
  });
});
