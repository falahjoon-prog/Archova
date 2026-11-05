import { describe, expect, it } from 'vitest';
import type { TakeoffDetectOutput } from '@archova/ai-prompts';
import {
  RASTER_CONFIDENCE_CAP,
  polygonSpan,
  reviewDetection,
} from '../../src/domain/takeoff-detect';

const item = (points: Array<[number, number]>, confidence = 0.9, place: string | null = null) => ({
  place,
  points: points.map(([x, y]) => ({ x, y })),
  confidence,
  note: null,
});
const out = (items: TakeoffDetectOutput['items']): TakeoffDetectOutput => ({ items, caveat: null });
const vector = { scanned: false };

describe('Nova Esti detection review', () => {
  it('keeps counts on the sheet and drops ones off it or repeated', () => {
    const r = reviewDetection(
      out([item([[0.2, 0.2]]), item([[0.2005, 0.2003]]), item([[1.2, 0.5]]), item([[0.6, 0.4]])]),
      'count',
      vector,
    );
    expect(r.items.map((i) => i.points[0])).toEqual([
      { x: 0.2, y: 0.2 },
      { x: 0.6, y: 0.4 },
    ]);
    expect(r.dropped).toBe(2);
  });

  it('reduces several points for one count to its centre', () => {
    const r = reviewDetection(
      out([
        item([
          [0.2, 0.2],
          [0.22, 0.24],
        ]),
      ]),
      'count',
      vector,
    );
    expect(r.items[0]!.points).toEqual([{ x: 0.21, y: 0.22 }]);
  });

  it('wants the right number of points for lengths and areas', () => {
    expect(reviewDetection(out([item([[0.1, 0.1]])]), 'length', vector).items).toHaveLength(0);
    expect(
      reviewDetection(
        out([
          item([
            [0.1, 0.1],
            [0.9, 0.1],
          ]),
        ]),
        'length',
        vector,
      ).items,
    ).toHaveLength(1);
    expect(
      reviewDetection(
        out([
          item([
            [0.1, 0.1],
            [0.9, 0.1],
          ]),
        ]),
        'area',
        vector,
      ).items,
    ).toHaveLength(0);
  });

  it('drops an area with no space inside it and a closing point repeated', () => {
    const flat = item([
      [0.1, 0.1],
      [0.5, 0.1],
      [0.9, 0.1],
    ]);
    expect(reviewDetection(out([flat]), 'area', vector).items).toHaveLength(0);
    const closed = item([
      [0.1, 0.1],
      [0.9, 0.1],
      [0.9, 0.9],
      [0.1, 0.1],
    ]);
    expect(reviewDetection(out([closed]), 'area', vector).items[0]!.points).toHaveLength(3);
    expect(
      polygonSpan([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ]),
    ).toBe(1);
  });

  it('caps confidence on scanned sheets so a person looks at every mark', () => {
    const r = reviewDetection(out([item([[0.3, 0.3]], 0.97), item([[0.5, 0.5]], 0.6)]), 'count', {
      scanned: true,
    });
    expect(r.items.map((i) => i.confidence)).toEqual([RASTER_CONFIDENCE_CAP, 0.6]);
  });
});
