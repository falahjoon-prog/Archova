import { describe, expect, it } from 'vitest';
import {
  MAX_VISUAL_REGIONS,
  cropTile,
  diffRasters,
  fitRaster,
  shiftRaster,
  type Box,
  type Raster,
} from '../../src/domain/visual-diff';

// Synthetic sheets: white paper with black rectangles and lines. 640 x 480 makes a 20 x 15 grid of 32 px cells.
const W = 640;
const H = 480;
const paper = (width = W, height = H): Raster => ({
  width,
  height,
  data: new Uint8Array(width * height).fill(255),
});
const fill = (r: Raster, x0: number, y0: number, x1: number, y1: number, v = 0) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) r.data[y * r.width + x] = v;
  return r;
};
/** A hollow rectangle drawn with 3 px lines, like a room outline. */
const outline = (r: Raster, x0: number, y0: number, x1: number, y1: number) => {
  fill(r, x0, y0, x1, y0 + 3);
  fill(r, x0, y1 - 3, x1, y1);
  fill(r, x0, y0, x0 + 3, y1);
  fill(r, x1 - 3, y0, x1, y1);
  return r;
};
const same = (a: Raster, b: Raster) =>
  a.width === b.width && a.height === b.height && Buffer.from(a.data).equals(Buffer.from(b.data));
const copy = (r: Raster): Raster => ({ ...r, data: r.data.slice() });

/** A sheet with a frame, a few rooms and a long wall, so alignment has structure to hold on to. */
function base(): Raster {
  const r = paper();
  outline(r, 20, 20, W - 20, H - 20);
  outline(r, 60, 60, 260, 200);
  outline(r, 300, 60, 560, 200);
  outline(r, 60, 250, 300, 420);
  fill(r, 340, 300, 540, 304);
  return r;
}

const inside = (b: Box, x: number, y: number) =>
  x / W >= b.x0 - 1e-9 && x / W <= b.x1 + 1e-9 && y / H >= b.y0 - 1e-9 && y / H <= b.y1 + 1e-9;

describe('diffRasters (F21 vision pass)', () => {
  it('finds nothing in two identical sheets', () => {
    const d = diffRasters(base(), base());
    expect(d).toMatchObject({ reliable: true, reason: null, regions: [], truncated: false });
    expect(d.shift).toEqual({ dx: 0, dy: 0 });
  });

  it('finds ink that was added, as one region around it', () => {
    const after = base();
    fill(after, 100, 100, 160, 130); // a new fixture
    const d = diffRasters(base(), after);
    expect(d.regions).toHaveLength(1);
    const r = d.regions[0]!;
    expect(r).toMatchObject({ id: 'r1', kind: 'added', removedPx: 0 });
    expect(r.addedPx).toBe(60 * 30);
    expect(inside(r, 100, 100) && inside(r, 160, 130)).toBe(true);
    // The box is on the cell grid, so it is a little larger than the ink but nowhere near the whole sheet.
    expect((r.x1 - r.x0) * (r.y1 - r.y0)).toBeLessThan(0.05);
  });

  it('finds ink that was removed', () => {
    const before = base();
    fill(before, 400, 100, 440, 160);
    const d = diffRasters(before, base());
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0]).toMatchObject({ kind: 'removed', addedPx: 0, removedPx: 40 * 60 });
  });

  it('reports a moved item as two regions, one removed and one added', () => {
    const before = base();
    fill(before, 80, 90, 120, 120);
    const after = base();
    fill(after, 440, 90, 480, 120);
    const d = diffRasters(before, after);
    expect(d.regions.map((r) => r.kind).sort()).toEqual(['added', 'removed']);
    const added = d.regions.find((r) => r.kind === 'added')!;
    const removed = d.regions.find((r) => r.kind === 'removed')!;
    expect(inside(added, 460, 105)).toBe(true);
    expect(inside(removed, 100, 105)).toBe(true);
  });

  it('calls a region changed when ink came and went in the same place', () => {
    const before = base();
    fill(before, 100, 100, 160, 130);
    const after = base();
    fill(after, 120, 110, 180, 140);
    const d = diffRasters(before, after);
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0]!.kind).toBe('changed');
  });

  it('merges changes with one empty cell between them into one region', () => {
    const after = base();
    fill(after, 96, 100, 128, 128); // cell column 3
    fill(after, 160, 100, 192, 128); // cell column 5; column 4 is empty
    const d = diffRasters(base(), after);
    expect(d.regions).toHaveLength(1);
    expect(inside(d.regions[0]!, 96, 100) && inside(d.regions[0]!, 192, 128)).toBe(true);
  });

  it('keeps changes apart when there is more than a cell between them, biggest first', () => {
    const after = base();
    fill(after, 96, 96, 128, 128); // 1024 px, cell column 3
    fill(after, 192, 96, 224, 128); // cell column 6: two empty cells between
    fill(after, 400, 330, 480, 380); // 4000 px
    const d = diffRasters(base(), after);
    expect(d.regions.map((r) => [r.id, r.addedPx])).toEqual([
      ['r1', 4000],
      ['r2', 1024],
      ['r3', 1024],
    ]);
  });

  it('lines the sheets up when the whole drawing moved a few pixels', () => {
    const before = base();
    const after = shiftRaster(base(), 7, -5);
    fill(after, 100, 100, 160, 130);
    const d = diffRasters(before, after);
    expect(d.shift).toEqual({ dx: 7, dy: -5 });
    expect(d.reliable).toBe(true);
    expect(d.regions).toHaveLength(1);
    expect(d.regions[0]).toMatchObject({ kind: 'added' });
    // The old sheet came back moved onto the new one, so tiles of the two match.
    expect(same(d.alignedBefore, shiftRaster(before, 7, -5))).toBe(true);
  });

  it('does not drag the sheet around because something was added', () => {
    const after = base();
    fill(after, 100, 100, 200, 130);
    const d = diffRasters(base(), after);
    expect(d.shift).toEqual({ dx: 0, dy: 0 });
    expect(same(d.alignedBefore, base())).toBe(true);
    expect(d.regions).toHaveLength(1);
  });

  it('ignores line wobble and anti-aliasing: a line one pixel thicker or thinner is not a change', () => {
    const after = base();
    // Every wall a pixel thicker on one side, and grey edge pixels along them.
    fill(after, 60, 59, 260, 60);
    fill(after, 60, 200, 260, 201, 120);
    fill(after, 300, 60, 301, 200, 200); // light grey, not ink
    const d = diffRasters(base(), after);
    expect(d.regions).toEqual([]);
  });

  it('ignores a few stray specks', () => {
    const after = base();
    for (const [x, y] of [
      [150, 140],
      [330, 120],
      [90, 330],
    ] as const)
      fill(after, x, y, x + 2, y + 2);
    expect(diffRasters(base(), after).regions).toEqual([]);
  });

  it('says so when most of the sheet changed, instead of listing hundreds of regions', () => {
    const before = base();
    const after = paper();
    // A different drawing: ink all over the sheet in places the old one has none.
    for (let y = 30; y < H - 30; y += 24) fill(after, 30, y, W - 30, y + 4);
    const d = diffRasters(before, after);
    expect(d).toMatchObject({ reliable: false, reason: 'too_different', regions: [] });
  });

  it('refuses two sheets of different shape', () => {
    const portrait = paper(480, 640);
    fill(portrait, 10, 10, 100, 100);
    expect(diffRasters(base(), portrait)).toMatchObject({
      reliable: false,
      reason: 'different_size',
      regions: [],
    });
    // Same long side but a different page ratio.
    const squarer = paper(640, 400);
    fill(squarer, 10, 10, 100, 100);
    expect(diffRasters(base(), squarer).reason).toBe('different_size');
  });

  it('refuses a blank sheet, which is a failed render rather than a revision', () => {
    expect(diffRasters(base(), paper())).toMatchObject({ reliable: false, reason: 'blank' });
    expect(diffRasters(paper(), base())).toMatchObject({ reliable: false, reason: 'blank' });
  });

  it('keeps the 12 biggest regions of a busy revision and says some were left out', () => {
    const before = paper(1280, 960);
    fill(before, 20, 20, 1260, 24); // a head rule, so the sheet has ink
    const after = copy(before);
    // 14 new marks on a wide pitch, the n-th one (n + 20) pixels wide and 20 high.
    for (let n = 0; n < 14; n++) {
      const x = 60 + (n % 7) * 170;
      const y = 120 + Math.floor(n / 7) * 300;
      fill(after, x, y, x + 20 + n, y + 20);
    }
    const d = diffRasters(before, after);
    expect(d.reliable).toBe(true);
    expect(d.regions).toHaveLength(MAX_VISUAL_REGIONS);
    expect(d.truncated).toBe(true);
    // Biggest first: the widest mark is region 1, and the two smallest marks are the ones left out.
    expect(d.regions[0]!.addedPx).toBe((20 + 13) * 20);
    const sizes = d.regions.map((r) => r.addedPx);
    expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
    expect(Math.min(...sizes)).toBe((20 + 2) * 20);
  });

  it('honours maxRegions and flags truncation', () => {
    const after = base();
    for (let i = 0; i < 5; i++) fill(after, 40 + i * 120, 215, 40 + i * 120 + 40, 245, 0);
    const d = diffRasters(base(), after, { maxRegions: 3 });
    expect(d.regions).toHaveLength(3);
    expect(d.truncated).toBe(true);
    expect(d.regions.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
    expect(diffRasters(base(), after).truncated).toBe(false);
  });
});

describe('shiftRaster', () => {
  it('moves the picture and fills what comes in with paper', () => {
    const r = paper(4, 3);
    r.data[0] = 0;
    const s = shiftRaster(r, 1, 2);
    expect(s.data[2 * 4 + 1]).toBe(0);
    expect(s.data[0]).toBe(255);
    expect(shiftRaster(r, 0, 0)).toBe(r);
  });
});

describe('tiles', () => {
  it('fits a raster to a side length without scaling up', () => {
    const f = fitRaster(paper(1000, 500), 250);
    expect([f.width, f.height]).toEqual([250, 125]);
    const small = paper(100, 50);
    expect(fitRaster(small, 250)).toBe(small);
    // Area averaging: a black square in white stays grey after shrinking.
    const dot = paper(8, 8);
    fill(dot, 0, 0, 4, 4);
    const grey = fitRaster(dot, 2);
    expect(Array.from(grey.data)).toEqual([0, 255, 255, 255]);
    const mixed = paper(4, 4);
    mixed.data[0] = 0;
    expect(fitRaster(mixed, 2).data[0]).toBe(191);
  });

  it('cuts the same box, with a margin, from either sheet', () => {
    const r = base();
    const t = cropTile(r, { x0: 0.25, y0: 0.25, x1: 0.5, y1: 0.5 }, 10_000);
    // 25% margin on a 160 x 120 box: 40 x 30 px each side.
    expect([t.width, t.height]).toEqual([240, 180]);
    expect(t.data[0]).toBe(r.data[90 * W + 120]);
  });

  it('stays inside the sheet near an edge and shrinks big tiles', () => {
    const t = cropTile(paper(), { x0: 0, y0: 0, x1: 1, y1: 1 }, 320);
    expect([t.width, t.height]).toEqual([320, 240]);
    const corner = cropTile(paper(), { x0: 0.95, y0: 0.95, x1: 1, y1: 1 }, 10_000);
    expect(corner.width).toBeLessThanOrEqual(W);
    expect(corner.width).toBeGreaterThanOrEqual(24);
  });
});
