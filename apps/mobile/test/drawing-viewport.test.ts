import { describe, expect, it, vi } from 'vitest';
import {
  clampViewport,
  fitViewport,
  levelForScale,
  levelSize,
  isTap,
  panViewport,
  supersededNotice,
  pinsOnRevision,
  pinToScreen,
  screenToPin,
  tileCacheKey,
  tileUrl,
  visibleTiles,
  zoomViewport,
  type Pyramid,
} from '../features/drawings';

vi.mock('../features/drawings/screens/DrawingRegisterScreen', () => ({}));
vi.mock('../features/drawings/screens/DrawingViewerScreen', () => ({}));

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

describe('gestures', () => {
  const fit = fitViewport(p, 1024, 768);
  const zoomed = { ...fit, scale: 0.5, x: 2000, y: 1000 };

  it('pans with the finger and stays on the sheet', () => {
    const v = panViewport(p, zoomed, 100, 0);
    expect(v.x).toBe(2000 - 100 / 0.5);
    expect(panViewport(p, zoomed, 1e6, 1e6).x).toBe(0);
  });

  it('keeps the pinched point fixed', () => {
    const focus = { x: 300, y: 200 };
    const before = { x: focus.x / zoomed.scale + zoomed.x, y: focus.y / zoomed.scale + zoomed.y };
    const v = zoomViewport(p, zoomed, 1.5, focus);
    expect(v.scale).toBeCloseTo(0.75);
    expect(focus.x / v.scale + v.x).toBeCloseTo(before.x);
    expect(focus.y / v.scale + v.y).toBeCloseTo(before.y);
  });

  it('will not zoom out past fit or in past the maximum', () => {
    expect(zoomViewport(p, zoomed, 0.001, { x: 0, y: 0 }).scale).toBeCloseTo(fit.scale);
    expect(zoomViewport(p, zoomed, 100, { x: 0, y: 0 }, 2).scale).toBe(2);
  });
});

describe('defect pins', () => {
  const d = (over: Record<string, unknown>) => ({
    id: 'dfc_1',
    number: 12,
    title: 'Cracked slab',
    status: 'open',
    priority: 'high',
    drawingRevisionId: 'rev_1',
    pinX: 0.25,
    pinY: 0.5,
    ...over,
  });

  it('keeps only pinned defects on this revision', () => {
    const pins = pinsOnRevision(
      [
        d({}),
        d({ id: 'dfc_2', drawingRevisionId: 'rev_2' }),
        d({ id: 'dfc_3', pinX: null }),
        d({ id: 'dfc_4', status: 'draft' }),
      ],
      'rev_1',
    );
    expect(pins.map((x) => x.defectId)).toEqual(['dfc_1']);
    expect(pins[0]).toMatchObject({ label: '#12', pinX: 0.25, resolved: false });
  });

  it('marks an unsynced defect and draws resolved pins first', () => {
    const pins = pinsOnRevision(
      [d({ id: 'a', number: null }), d({ id: 'b', status: 'closed' })],
      'rev_1',
    );
    expect(pins.map((x) => [x.defectId, x.label, x.resolved])).toEqual([
      ['b', '#12', true],
      ['a', 'New', false],
    ]);
  });
});

describe('superseded banner', () => {
  it('says nothing for a current or draft revision', () => {
    expect(supersededNotice({ status: 'current', rev: 'C', supersededBy: null })).toBeNull();
    expect(supersededNotice({ status: 'draft', rev: 'D', supersededBy: null })).toBeNull();
  });

  it('names the revision that replaced a superseded one', () => {
    const n = supersededNotice({
      status: 'superseded',
      rev: 'B',
      supersededBy: { revisionId: 'rev_c', rev: 'C', at: '2026-10-29T00:00:00.000Z' },
    });
    expect(n?.latestRevisionId).toBe('rev_c');
    expect(n?.message).toMatch(/Rev B is out of date.*Rev C replaced it/);
  });

  it('still warns when the successor is unknown', () => {
    const n = supersededNotice({ status: 'superseded', rev: 'B', supersededBy: null });
    expect(n?.message).toMatch(/out of date/);
    expect(n?.latestRevisionId).toBe('');
  });
});

describe('tap detection', () => {
  it('treats a small movement as a tap and a drag as a pan', () => {
    expect(isTap(2, 3)).toBe(true);
    expect(isTap(0, 0)).toBe(true);
    expect(isTap(20, 0)).toBe(false);
    expect(isTap(6, 6)).toBe(false);
  });
});
