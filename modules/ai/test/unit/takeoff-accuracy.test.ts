import { describe, expect, it } from 'vitest';
import {
  areaM2,
  lengthM,
  scoreDetection,
  type SheetScale,
} from '../../src/domain/takeoff-accuracy';

// A1 landscape at 1:100: 1 m is 10 mm of paper.
const sheet: SheetScale = { widthMm: 840, heightMm: 600, scale: 100 };
const c = (x: number, y: number) => ({ points: [{ x, y }] });

describe('takeoff accuracy', () => {
  it('measures in real units', () => {
    expect(
      lengthM(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
        ],
        sheet,
      ),
    ).toBeCloseTo(42, 6); // 420 mm paper = 42 m
    expect(
      areaM2(
        [
          { x: 0, y: 0 },
          { x: 0.5, y: 0 },
          { x: 0.5, y: 0.5 },
          { x: 0, y: 0.5 },
        ],
        sheet,
      ),
    ).toBeCloseTo(42 * 30, 6);
  });

  it('scores counts by matched symbols', () => {
    const truth = [c(0.1, 0.1), c(0.5, 0.5), c(0.9, 0.9), c(0.3, 0.7)];
    const r = scoreDetection('count', truth, [c(0.101, 0.1), c(0.5, 0.505), c(0.2, 0.2)], sheet);
    expect(r.recall).toBeCloseTo(0.5);
    expect(r.precision).toBeCloseTo(2 / 3);
    expect(r.quantityError).toBeCloseTo(0.25);
  });

  it('never matches one true symbol twice', () => {
    const r = scoreDetection('count', [c(0.5, 0.5)], [c(0.5, 0.5), c(0.502, 0.5)], sheet);
    expect(r.precision).toBeCloseTo(0.5);
    expect(r.recall).toBe(1);
  });

  it('scores area by total quantity error', () => {
    const square = (s: number) => ({
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.1 + s, y: 0.1 },
        { x: 0.1 + s, y: 0.1 + s },
        { x: 0.1, y: 0.1 + s },
      ],
    });
    const r = scoreDetection('area', [square(0.2)], [square(0.21)], sheet);
    expect(r.quantityError).toBeCloseTo(0.1025, 3);
  });

  it('handles nothing expected', () => {
    expect(scoreDetection('count', [], [], sheet)).toMatchObject({
      precision: 1,
      recall: 1,
      quantityError: 0,
    });
    expect(scoreDetection('count', [], [c(0.1, 0.1)], sheet).quantityError).toBe(1);
  });
});
