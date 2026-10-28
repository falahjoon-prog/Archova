import { describe, expect, it, vi } from 'vitest';
import {
  clampViewport,
  fitViewport,
  levelForScale,
  levelSize,
  pinToScreen,
  screenToPin,
  tileCacheKey,
  tileUrl,
  visibleTiles,
  type Pyramid,
} from '../features/drawings';

vi.mock('../features/drawings/screens/DrawingRegisterScreen', () => ({}));

// An A1-ish sheet: 8192 x 4096 at full size, four levels (1024 x 512 at the bottom).
const p: Pyramid = { width: 8192, height: 4096, tileSize: 256, levels: 4 };

describe('pyramid', () => {
  it('halves each level', () => {
    expect(levelSize(p, 3)).toEqual({ width: 8192, height: 4096 });
    expect(levelSize(p, 0)).toEqual({ width: 1024, height: 512 });
  });

  it('picks the lowest level that is sharp', () => {
    expect(levelForScale(p, 0.1)).toBe(0);
    expect(levelForScale(p, 0.2)).toBe(1);
    expect(levelForScale(p, 1)).toBe(3);
    expect(levelForScale(p, 3)).toBe(3);
  });
});

describe('viewport', () => {
  it('fits the whole sheet and centres it', () => {
    const v = fitViewport(p, 400, 400);
    expect(v.scale).toBeCloseTo(400 / 8192);
    expect(v.x).toBe(0);
    expect(v.y).toBeLessThan(0);
  });

  it('will not zoom out past fit or pan off the sheet', () => {
    const fit = fitViewport(p, 400, 400);
    expect(clampViewport(p, { ...fit, scale: 0.001 }).scale).toBeCloseTo(fit.scale);
    const zoomed = clampViewport(p, { ...fit, scale: 0.5, x: -999, y: 99999 });
    expect(zoomed.x).toBe(0);
    expect(zoomed.y).toBe(4096 - 400 / 0.5);
  });

  it('lists only the tiles on screen', () => {
    const full = visibleTiles(p, fitViewport(p, 400, 400));
    expect(full.every((t) => t.z === 0)).toBe(true);
    expect(full).toHaveLength(8); // 4 x 2 tiles at the bottom level
    const zoomed = visibleTiles(p, { scale: 1, x: 0, y: 0, screenWidth: 512, screenHeight: 256 });
    expect(zoomed).toEqual([
      { z: 3, x: 0, y: 0 },
      { z: 3, x: 1, y: 0 },
    ]);
  });
});

describe('pins', () => {
  it('round-trips between sheet and screen', () => {
    const v = { scale: 0.25, x: 1000, y: 500, screenWidth: 800, screenHeight: 600 };
    const s = pinToScreen(p, v, { pinX: 0.25, pinY: 0.25 });
    expect(s).toEqual({ x: 262, y: 131, onScreen: true });
    const back = screenToPin(p, v, s);
    expect(back.pinX).toBeCloseTo(0.25, 2);
    expect(back.pinY).toBeCloseTo(0.25, 2);
  });

  it('flags pins that are off screen', () => {
    const v = { scale: 1, x: 0, y: 0, screenWidth: 100, screenHeight: 100 };
    expect(pinToScreen(p, v, { pinX: 0.9, pinY: 0.9 }).onScreen).toBe(false);
  });
});

describe('tile urls', () => {
  it('fills the template and builds a stable cache key', () => {
    const t = { z: 2, x: 5, y: 1 };
    expect(tileUrl('https://cdn/x/{z}/{x}/{y}.webp', t)).toBe('https://cdn/x/2/5/1.webp');
    expect(tileCacheKey('rev1', t)).toBe('rev1/2/5/1');
  });
});
