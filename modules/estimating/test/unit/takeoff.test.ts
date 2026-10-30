import { describe, expect, it } from 'vitest';
import { confirmedOnCreate, measurementProblem } from '../../src/domain/takeoff';

const square = {
  type: 'polygon' as const,
  points: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
};

describe('takeoff rules', () => {
  it('wants the right shape for each kind', () => {
    expect(measurementProblem('area', square, 3)).toBeNull();
    expect(measurementProblem('length', square, 3)?.path).toBe('geometry/type');
    expect(
      measurementProblem(
        'area',
        {
          type: 'polygon',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
        3,
      )?.path,
    ).toBe('geometry/points');
  });

  it('accepts cut-outs on an area only, each with three finite points', () => {
    const hole = [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.2, 0.2],
    ];
    expect(measurementProblem('area', { ...square, holes: [hole] }, 3)).toBeNull();
    expect(measurementProblem('area', { ...square, holes: [hole.slice(0, 2)] }, 3)?.path).toBe(
      'geometry/holes',
    );
    expect(
      measurementProblem(
        'length',
        {
          type: 'polyline',
          points: [
            [0, 0],
            [1, 1],
          ],
          holes: [hole],
        },
        1,
      )?.path,
    ).toBe('geometry/holes');
  });

  it('keeps a count equal to the points placed and quantities non-negative', () => {
    const pts = {
      type: 'points' as const,
      points: [
        [1, 1],
        [2, 2],
      ],
    };
    expect(measurementProblem('count', pts, 2)).toBeNull();
    expect(measurementProblem('count', pts, 3)?.path).toBe('quantity');
    expect(measurementProblem('area', square, -1)?.path).toBe('quantity');
    expect(measurementProblem('area', square, Number.NaN)?.path).toBe('quantity');
  });

  it('confirms only hand-drawn measurements on creation', () => {
    expect(confirmedOnCreate('manual')).toBe(true);
    expect(confirmedOnCreate('assisted')).toBe(false);
    expect(confirmedOnCreate('auto')).toBe(false);
  });
});
