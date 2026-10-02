import { describe, expect, it } from 'vitest';
import {
  areaWithDeductionsM2,
  buildSnapIndex,
  calibrateScale,
  formatQuantity,
  formatScale,
  parseScale,
  perimeterM,
  polygonAreaM2,
  polylineLengthM,
  snapPoint,
  takeoffQuantity,
} from '../src';

// A1 landscape. At 1:100, 0.1 of the width is 84.1 mm on paper = 8.41 m on site.
const A1 = { widthMm: 841, heightMm: 594 };

describe('scale', () => {
  it('parses and formats 1:N', () => {
    expect(parseScale('1:100')).toBe(100);
    expect(parseScale(' 1 : 50 ')).toBe(50);
    expect(parseScale('200')).toBe(200);
    expect(parseScale('1:0')).toBeNull();
    expect(parseScale('abc')).toBeNull();
    expect(formatScale(100)).toBe('1:100');
  });

  it('calibrates from a known dimension', () => {
    // 84.1 mm on paper that is 8.41 m on site → 1:100.
    expect(calibrateScale({ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }, 8.41, A1)).toBeCloseTo(100, 6);
    expect(() => calibrateScale({ x: 0.1, y: 0.1 }, { x: 0.1, y: 0.1 }, 5, A1)).toThrow(RangeError);
  });
});

describe('length, area and perimeter', () => {
  it('measures a polyline in metres using both sheet axes', () => {
    const pts = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.1 }, // 84.1 mm
      { x: 0.2, y: 0.2 }, // 59.4 mm
    ];
    expect(polylineLengthM(pts, A1, 100)).toBeCloseTo(8.41 + 5.94, 6);
  });

  it('measures a rectangle room and its perimeter', () => {
    const room = [
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.1, y: 0.2 },
    ];
    expect(polygonAreaM2(room, A1, 100)).toBeCloseTo(8.41 * 5.94, 6);
    expect(perimeterM(room, A1, 100)).toBeCloseTo(2 * (8.41 + 5.94), 6);
    // Winding direction does not matter.
    expect(polygonAreaM2([...room].reverse(), A1, 100)).toBeCloseTo(8.41 * 5.94, 6);
  });

  it('deducts cut-outs and never goes negative', () => {
    const outer = [
      { x: 0, y: 0 },
      { x: 0.1, y: 0 },
      { x: 0.1, y: 0.1 },
      { x: 0, y: 0.1 },
    ];
    const hole = [
      { x: 0.02, y: 0.02 },
      { x: 0.07, y: 0.02 },
      { x: 0.07, y: 0.07 },
      { x: 0.02, y: 0.07 },
    ];
    const gross = polygonAreaM2(outer, A1, 100);
    expect(areaWithDeductionsM2(outer, [hole], A1, 100)).toBeCloseTo(gross * 0.75, 6);
    expect(areaWithDeductionsM2(hole, [outer], A1, 100)).toBe(0);
  });

  it('counts markers and formats quantities with AU units', () => {
    expect(
      takeoffQuantity(
        {
          kind: 'count',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
        A1,
        100,
      ),
    ).toBe(2);
    expect(formatQuantity(1234.567, 'm2')).toBe('1,234.57 m²');
    expect(formatQuantity(12.3, 'm')).toBe('12.30 m');
    expect(formatQuantity(7, 'ea')).toBe('7 ea');
  });
});

describe('snapping', () => {
  const index = buildSnapIndex([
    { a: { x: 0.1, y: 0.1 }, b: { x: 0.5, y: 0.1 } },
    { a: { x: 0.5, y: 0.1 }, b: { x: 0.5, y: 0.5 } },
  ]);

  it('prefers endpoints, then midpoints, then edges', () => {
    expect(snapPoint(index, { x: 0.502, y: 0.103 }, 0.01)).toMatchObject({
      kind: 'endpoint',
      point: { x: 0.5, y: 0.1 },
    });
    expect(snapPoint(index, { x: 0.301, y: 0.104 }, 0.01)).toMatchObject({
      kind: 'midpoint',
      point: { x: 0.3, y: 0.1 },
    });
    const edge = snapPoint(index, { x: 0.2, y: 0.105 }, 0.01);
    expect(edge?.kind).toBe('edge');
    expect(edge?.point.y).toBeCloseTo(0.1, 9);
    expect(edge?.point.x).toBeCloseTo(0.2, 9);
  });

  it('returns null when nothing is within tolerance', () => {
    expect(snapPoint(index, { x: 0.8, y: 0.8 }, 0.01)).toBeNull();
  });
});
