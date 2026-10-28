// Takeoff measurement rules (product/10 EST-US7, X30). Pure rules, no IO.

export type MeasurementKind = 'length' | 'area' | 'count';
export type MeasurementSource = 'manual' | 'assisted' | 'auto';
export type GeometryType = 'polyline' | 'polygon' | 'points';

export interface Geometry {
  type: GeometryType;
  points: number[][];
}

const SHAPE: Record<MeasurementKind, { type: GeometryType; min: number }> = {
  length: { type: 'polyline', min: 2 },
  area: { type: 'polygon', min: 3 },
  count: { type: 'points', min: 1 },
};

/** The first problem with a measurement's shape and quantity, or null when it holds together. */
export function measurementProblem(
  kind: MeasurementKind,
  geometry: Geometry,
  quantity: number,
): { path: string; message: string } | null {
  const shape = SHAPE[kind];
  if (geometry.type !== shape.type)
    return { path: 'geometry/type', message: `A ${kind} measurement is a ${shape.type}` };
  if (geometry.points.length < shape.min)
    return { path: 'geometry/points', message: `Needs at least ${shape.min} points` };
  if (!geometry.points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)))
    return { path: 'geometry/points', message: 'Points must be finite numbers' };
  if (!Number.isFinite(quantity) || quantity < 0)
    return { path: 'quantity', message: 'Quantity cannot be negative' };
  if (kind === 'count' && quantity !== geometry.points.length)
    return { path: 'quantity', message: 'A count is the number of points placed' };
  return null;
}

/** Hand-drawn measurements are the estimator's own word; Nova's wait for a person to confirm them. */
export const confirmedOnCreate = (source: MeasurementSource) => source === 'manual';
