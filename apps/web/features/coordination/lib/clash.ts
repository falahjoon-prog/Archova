// Clash detection between model elements. Boxes are axis-aligned bounds in metres, in the models' shared world
// axes (Y up, as web-ifc reads them). This is a coarse first pass: two elements "clash" when their bounds overlap by more than the
// tolerance on every axis. Diagonal or curved elements can be flagged when the elements themselves do not touch,
// so a result is a candidate for a person to confirm, never a verdict.

export type Vec3 = readonly [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface ModelElement {
  modelId: string;
  /** The element's id inside its file, so a clash can be found again in the loaded model. */
  expressId: number;
  /** IFC GlobalId. */
  guid: string;
  name: string;
  /** IFC entity name, e.g. `IfcWall`. */
  ifcType: string;
  box: Box;
}

export interface Clash {
  a: ModelElement;
  b: ModelElement;
  /** Overlap on each axis, in metres. */
  overlap: Vec3;
  /** Smallest overlap: how far one element would have to move to clear the other. */
  depth: number;
  /** Volume of the overlapping region, in cubic metres. */
  volume: number;
}

export interface ClashOptions {
  /** Overlaps no deeper than this, in metres, are ignored. Default 5 mm. */
  tolerance?: number;
  /** Also report elements that come within this many metres of each other. Default 0. */
  clearance?: number;
  /** Compare elements inside the same model as well as across models. Default false. */
  withinModel?: boolean;
  /** Stop after this many clashes. Default 500. */
  limit?: number;
}

export interface ClashResult {
  clashes: Clash[];
  /** True when `limit` cut the list short. */
  truncated: boolean;
}

export const EMPTY_BOX: Box = { min: [0, 0, 0], max: [0, 0, 0] };

/** Bounds of a flat `x,y,z,…` position array, or null when it holds no points. */
export function boundsOf(positions: ArrayLike<number>): Box | null {
  if (positions.length < 3) return null;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity,
    maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null;
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

/** Joins boxes into one that holds them all. */
export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return b;
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

/** Applies a column-major 4x4 matrix (as IFC meshes carry it) to a flat position array. */
export function transformPositions(
  positions: ArrayLike<number>,
  m: ArrayLike<number>,
): Float32Array {
  const out = new Float32Array(positions.length);
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i]!,
      y = positions[i + 1]!,
      z = positions[i + 2]!;
    out[i] = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
    out[i + 1] = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
    out[i + 2] = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  }
  return out;
}

/** Finds the pairs of elements whose bounds overlap, deepest first. Sweeps along X so it stays fast on large models. */
export function detectClashes(
  elements: readonly ModelElement[],
  options: ClashOptions = {},
): ClashResult {
  const tolerance = options.tolerance ?? 0.005;
  const clearance = options.clearance ?? 0;
  const limit = options.limit ?? 500;
  const sorted = [...elements].sort((p, q) => p.box.min[0] - q.box.min[0]);
  const clashes: Clash[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      // Sorted by min X: once b starts beyond a's far edge (plus slack) no later element can touch a.
      if (b.box.min[0] > a.box.max[0] + clearance) break;
      if (!options.withinModel && a.modelId === b.modelId) continue;
      const ox = Math.min(a.box.max[0], b.box.max[0]) - Math.max(a.box.min[0], b.box.min[0]);
      const oy = Math.min(a.box.max[1], b.box.max[1]) - Math.max(a.box.min[1], b.box.min[1]);
      const oz = Math.min(a.box.max[2], b.box.max[2]) - Math.max(a.box.min[2], b.box.min[2]);
      if (ox + clearance <= tolerance || oy + clearance <= tolerance || oz + clearance <= tolerance)
        continue;
      clashes.push({
        a,
        b,
        overlap: [ox, oy, oz],
        depth: Math.min(ox, oy, oz),
        volume: Math.max(ox, 0) * Math.max(oy, 0) * Math.max(oz, 0),
      });
    }
  }
  clashes.sort((p, q) => q.volume - p.volume || q.depth - p.depth);
  return { clashes: clashes.slice(0, limit), truncated: clashes.length > limit };
}

/** A one-line description for the issue title: "Wall W-12 (Architectural) × Duct D-4 (Mechanical)". */
export function clashTitle(c: Clash, modelName: (id: string) => string): string {
  const side = (e: ModelElement) => `${e.name || e.ifcType} (${modelName(e.modelId)})`;
  return `${side(c.a)} × ${side(c.b)}`.slice(0, 200);
}
