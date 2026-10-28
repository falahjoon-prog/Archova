// F21 vision pass (ai/01 F21): where the linework of a sheet changed between two revisions. Code renders nothing and
// calls no model here: it takes two greyscale pictures of the same sheet, lines them up, and finds the regions where
// ink was added or removed. Nova only describes regions this finds, so it can't invent a change, and a change it
// doesn't describe is still listed. Pure, no IO; the renderer (pdf.js on a native canvas, which the API image
// doesn't ship) is injected by whoever has one.

/** Eight-bit greyscale, one byte a pixel, 0 black to 255 white. Same shape as `GreyImage` in infra/raster. */
export interface Raster {
  width: number;
  height: number;
  data: Uint8Array;
}

/** A box on the new sheet in normalised coordinates (0..1, origin top-left, as pins and markups). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type RegionKind = 'added' | 'removed' | 'changed';

export interface VisualRegion extends Box {
  /** `r1` is the region with the most changed ink. */
  id: string;
  kind: RegionKind;
  /** Ink pixels on the new sheet with none on the old one nearby, and the other way round (working resolution). */
  addedPx: number;
  removedPx: number;
}

export type UnreliableReason = 'different_size' | 'too_different' | 'blank';

export interface VisualDiff {
  /** False when the two pictures can't be compared line for line; `regions` is then empty and `reason` says why. */
  reliable: boolean;
  reason: UnreliableReason | null;
  regions: VisualRegion[];
  /** More regions were found than kept (the biggest are kept). */
  truncated: boolean;
  /** How far the old sheet had to move to line up with the new one, in pixels. */
  shift: { dx: number; dy: number };
  /** The old sheet moved onto the new one: tiles of it must be cut from this, not from the original. */
  alignedBefore: Raster;
}

export interface DiffOptions {
  /** Darker than this is ink. */
  inkBelow?: number;
  /** A pixel counts as changed only when the other sheet has no ink within this many pixels (line width wobble). */
  tolerance?: number;
  /** Largest shift tried when lining the sheets up. */
  maxShift?: number;
  /** Side of a grid cell the changes are counted in. */
  cell?: number;
  /** Changed ink pixels a cell needs to count. */
  cellMinPx?: number;
  /** Regions with less changed ink than this are noise. */
  regionMinPx?: number;
  maxRegions?: number;
  /** More than this share of cells changed: the sheet was redrawn, not revised. */
  redrawShare?: number;
}

const DEFAULTS: Required<DiffOptions> = {
  inkBelow: 160,
  tolerance: 2,
  maxShift: 16,
  cell: 32,
  cellMinPx: 10,
  regionMinPx: 40,
  maxRegions: 12,
  redrawShare: 0.25,
};

export const MAX_VISUAL_REGIONS = DEFAULTS.maxRegions;

const inkMask = (r: Raster, below: number): Uint8Array => {
  const out = new Uint8Array(r.data.length);
  for (let i = 0; i < out.length; i++) out[i] = r.data[i]! < below ? 1 : 0;
  return out;
};

/** Ink mask grown by `radius` pixels in every direction (separable max filter). */
function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      for (let k = Math.max(0, x - radius); k <= Math.min(w - 1, x + radius); k++) tmp[row + k] = 1;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (!tmp[y * w + x]) continue;
      for (let k = Math.max(0, y - radius); k <= Math.min(h - 1, y + radius); k++)
        out[k * w + x] = 1;
    }
  }
  return out;
}

function profiles(mask: Uint8Array, w: number, h: number) {
  const cols = new Float64Array(w);
  const rows = new Float64Array(h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        cols[x] = cols[x]! + 1;
        rows[y] = rows[y]! + 1;
      }
  return { cols, rows };
}

/** The shift `s` that makes `a[i]` best match `b[i + s]`, by mean absolute difference; 0 unless clearly better. */
function bestShift(a: Float64Array, b: Float64Array, maxShift: number): number {
  const cost = (s: number) => {
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, -s); i < Math.min(a.length, b.length - s); i++) {
      sum += Math.abs(a[i]! - b[i + s]!);
      n++;
    }
    return n ? sum / n : Infinity;
  };
  const base = cost(0);
  let best = 0;
  let bestCost = base;
  for (let s = -maxShift; s <= maxShift; s++) {
    if (s === 0) continue;
    const c = cost(s);
    if (c < bestCost) {
      best = s;
      bestCost = c;
    }
  }
  // Only move the sheet when it clearly lines up better: a real change must not drag the sheet around.
  return bestCost < base * 0.8 ? best : 0;
}

/** `r` moved right by `dx` and down by `dy`; what comes in from outside is paper. */
export function shiftRaster(r: Raster, dx: number, dy: number): Raster {
  if (!dx && !dy) return r;
  const data = new Uint8Array(r.data.length).fill(255);
  for (let y = 0; y < r.height; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= r.height) continue;
    for (let x = 0; x < r.width; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < r.width) data[y * r.width + x] = r.data[sy * r.width + sx]!;
    }
  }
  return { width: r.width, height: r.height, data };
}

const unreliable = (reason: UnreliableReason, before: Raster): VisualDiff => ({
  reliable: false,
  reason,
  regions: [],
  truncated: false,
  shift: { dx: 0, dy: 0 },
  alignedBefore: before,
});

/**
 * Where ink was added to or removed from a sheet. Both pictures must show the whole sheet at the same scale (the
 * renderer fits the longer side to one length, so two issues of the same sheet size match); `different_size` is
 * returned when the proportions differ, `too_different` when most of the sheet changed (it was redrawn, not revised),
 * and `blank` when a sheet has no ink.
 */
export function diffRasters(before: Raster, after: Raster, options: DiffOptions = {}): VisualDiff {
  const o = { ...DEFAULTS, ...options };
  const { width: w, height: h } = after;
  if (
    before.width !== w ||
    before.height !== h ||
    Math.abs(before.width / before.height - after.width / after.height) > 0.01
  )
    return unreliable('different_size', before);

  const inkBefore0 = inkMask(before, o.inkBelow);
  const inkAfter = inkMask(after, o.inkBelow);
  const total = (m: Uint8Array) => m.reduce((n, v) => n + v, 0);
  if (!total(inkBefore0) || !total(inkAfter)) return unreliable('blank', before);

  const pa = profiles(inkBefore0, w, h);
  const pb = profiles(inkAfter, w, h);
  const dx = bestShift(pa.cols, pb.cols, o.maxShift);
  const dy = bestShift(pa.rows, pb.rows, o.maxShift);
  const alignedBefore = shiftRaster(before, dx, dy);
  const inkBefore = dx || dy ? inkMask(alignedBefore, o.inkBelow) : inkBefore0;

  const nearBefore = dilate(inkBefore, w, h, o.tolerance);
  const nearAfter = dilate(inkAfter, w, h, o.tolerance);
  const cols = Math.ceil(w / o.cell);
  const rows = Math.ceil(h / o.cell);
  const added = new Uint32Array(cols * rows);
  const removed = new Uint32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    const c0 = Math.floor(y / o.cell) * cols;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (inkAfter[i] && !nearBefore[i]) added[c0 + Math.floor(x / o.cell)]!++;
      else if (inkBefore[i] && !nearAfter[i]) removed[c0 + Math.floor(x / o.cell)]!++;
    }
  }

  const active = new Uint8Array(cols * rows);
  let activeCells = 0;
  for (let i = 0; i < active.length; i++)
    if (added[i]! + removed[i]! >= o.cellMinPx) {
      active[i] = 1;
      activeCells++;
    }
  if (activeCells / active.length > o.redrawShare)
    return { ...unreliable('too_different', alignedBefore), shift: { dx, dy } };

  // Changed cells with at most one empty cell between them belong to the same region.
  const seen = new Uint8Array(active.length);
  const found: Array<{ box: Box; addedPx: number; removedPx: number }> = [];
  for (let start = 0; start < active.length; start++) {
    if (!active[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let c0 = cols;
    let r0 = rows;
    let c1 = -1;
    let r1 = -1;
    let addedPx = 0;
    let removedPx = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const c = k % cols;
      const r = (k - c) / cols;
      c0 = Math.min(c0, c);
      r0 = Math.min(r0, r);
      c1 = Math.max(c1, c);
      r1 = Math.max(r1, r);
      addedPx += added[k]!;
      removedPx += removed[k]!;
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const n = nr * cols + nc;
          if (active[n] && !seen[n]) {
            seen[n] = 1;
            stack.push(n);
          }
        }
    }
    if (addedPx + removedPx < o.regionMinPx) continue;
    found.push({
      box: {
        x0: (c0 * o.cell) / w,
        y0: (r0 * o.cell) / h,
        x1: Math.min(1, ((c1 + 1) * o.cell) / w),
        y1: Math.min(1, ((r1 + 1) * o.cell) / h),
      },
      addedPx,
      removedPx,
    });
  }

  found.sort((a, b) => b.addedPx + b.removedPx - (a.addedPx + a.removedPx));
  const regions = found.slice(0, o.maxRegions).map((f, i): VisualRegion => {
    const sum = f.addedPx + f.removedPx;
    const kind: RegionKind =
      f.removedPx <= sum * 0.1 ? 'added' : f.addedPx <= sum * 0.1 ? 'removed' : 'changed';
    return { id: `r${i + 1}`, ...f.box, kind, addedPx: f.addedPx, removedPx: f.removedPx };
  });
  return {
    reliable: true,
    reason: null,
    regions,
    truncated: found.length > o.maxRegions,
    shift: { dx, dy },
    alignedBefore,
  };
}

/** Area-averaged copy of `r` with the longer side at most `maxSide` (never scaled up). */
export function fitRaster(r: Raster, maxSide: number): Raster {
  const scale = Math.min(1, maxSide / Math.max(r.width, r.height));
  if (scale === 1) return r;
  const width = Math.max(1, Math.round(r.width * scale));
  const height = Math.max(1, Math.round(r.height * scale));
  const sum = new Float64Array(width * height);
  const count = new Uint32Array(width * height);
  for (let y = 0; y < r.height; y++) {
    const row = Math.min(height - 1, Math.floor(y * scale)) * width;
    for (let x = 0; x < r.width; x++) {
      const k = row + Math.min(width - 1, Math.floor(x * scale));
      sum[k] = sum[k]! + r.data[y * r.width + x]!;
      count[k] = count[k]! + 1;
    }
  }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = count[i] ? Math.round(sum[i]! / count[i]!) : 255;
  return { width, height, data };
}

/**
 * The part of a sheet around a region, with a margin so the model sees what the change sits next to, shrunk to fit
 * `maxSide`. The same box is cut from the old and the new sheet.
 */
export function cropTile(r: Raster, box: Box, maxSide = 640, margin = 0.25): Raster {
  const mx = Math.max(24 / r.width, (box.x1 - box.x0) * margin);
  const my = Math.max(24 / r.height, (box.y1 - box.y0) * margin);
  const x0 = Math.max(0, Math.floor((box.x0 - mx) * r.width));
  const y0 = Math.max(0, Math.floor((box.y0 - my) * r.height));
  const x1 = Math.min(r.width, Math.ceil((box.x1 + mx) * r.width));
  const y1 = Math.min(r.height, Math.ceil((box.y1 + my) * r.height));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    data.set(r.data.subarray((y0 + y) * r.width + x0, (y0 + y) * r.width + x0 + width), y * width);
  return fitRaster({ width, height, data }, maxSide);
}
