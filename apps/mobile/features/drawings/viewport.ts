// Viewport and tile-pyramid maths for the drawing viewer (docs/mobile/03 §3.3). Pure, so it runs in Node tests.
// Level z = levels - 1 is full resolution; each lower level halves both sides. Tiles are tileSize px squares.

export interface Pyramid {
  /** Full-resolution sheet size in pixels. */
  width: number;
  height: number;
  tileSize: number;
  levels: number;
}

export interface Viewport {
  /** Screen pixels per full-resolution sheet pixel. */
  scale: number;
  /** Full-resolution sheet pixel shown at the screen's top-left corner. */
  x: number;
  y: number;
  screenWidth: number;
  screenHeight: number;
}

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

/** Size of level `z` in pixels. */
export function levelSize(p: Pyramid, z: number): { width: number; height: number } {
  const f = 2 ** (p.levels - 1 - z);
  return { width: Math.ceil(p.width / f), height: Math.ceil(p.height / f) };
}

/** The scale that fits the whole sheet on screen. */
export function fitScale(p: Pyramid, screenWidth: number, screenHeight: number): number {
  return Math.min(screenWidth / p.width, screenHeight / p.height);
}

export function fitViewport(p: Pyramid, screenWidth: number, screenHeight: number): Viewport {
  const scale = fitScale(p, screenWidth, screenHeight);
  return {
    scale,
    x: (p.width - screenWidth / scale) / 2,
    y: (p.height - screenHeight / scale) / 2,
    screenWidth,
    screenHeight,
  };
}

/** Keeps the sheet on screen: no zooming out past fit, no zooming in past `maxScale`, no panning off the sheet. */
export function clampViewport(p: Pyramid, v: Viewport, maxScale = 1): Viewport {
  const min = fitScale(p, v.screenWidth, v.screenHeight);
  const scale = Math.min(Math.max(v.scale, min), Math.max(maxScale, min));
  const viewW = v.screenWidth / scale;
  const viewH = v.screenHeight / scale;
  const clampAxis = (pos: number, view: number, size: number) =>
    view >= size ? (size - view) / 2 : Math.min(Math.max(pos, 0), size - view);
  return {
    ...v,
    scale,
    x: clampAxis(v.x, viewW, p.width),
    y: clampAxis(v.y, viewH, p.height),
  };
}

/** The lowest level that is sharp at this scale (one level pixel or more per screen pixel). */
export function levelForScale(p: Pyramid, scale: number): number {
  for (let z = 0; z < p.levels; z++) {
    const levelScale = levelSize(p, z).width / p.width;
    if (levelScale >= scale) return z;
  }
  return p.levels - 1;
}

/** Tiles covering the viewport at the sharp level, row by row. */
export function visibleTiles(p: Pyramid, v: Viewport): TileKey[] {
  const z = levelForScale(p, v.scale);
  const size = levelSize(p, z);
  const ls = size.width / p.width;
  const px = (n: number) => n * ls;
  const left = Math.max(0, px(v.x));
  const top = Math.max(0, px(v.y));
  const right = Math.min(size.width, px(v.x + v.screenWidth / v.scale));
  const bottom = Math.min(size.height, px(v.y + v.screenHeight / v.scale));
  if (right <= left || bottom <= top) return [];
  const x0 = Math.floor(left / p.tileSize);
  const x1 = Math.ceil(right / p.tileSize) - 1;
  const y0 = Math.floor(top / p.tileSize);
  const y1 = Math.ceil(bottom / p.tileSize) - 1;
  const tiles: TileKey[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return tiles;
}

/** Screen position of a pin held as normalised 0..1 sheet coordinates (defects' `pinX`, `pinY`). */
export function pinToScreen(
  p: Pyramid,
  v: Viewport,
  pin: { pinX: number; pinY: number },
): { x: number; y: number; onScreen: boolean } {
  const x = (pin.pinX * p.width - v.x) * v.scale;
  const y = (pin.pinY * p.height - v.y) * v.scale;
  return { x, y, onScreen: x >= 0 && y >= 0 && x <= v.screenWidth && y <= v.screenHeight };
}

/** Normalised sheet position of a screen point, for a long-press that raises a defect there. */
export function screenToPin(
  p: Pyramid,
  v: Viewport,
  point: { x: number; y: number },
): { pinX: number; pinY: number } {
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
  return {
    pinX: clamp01((point.x / v.scale + v.x) / p.width),
    pinY: clamp01((point.y / v.scale + v.y) / p.height),
  };
}

/** Cache key for an immutable tile (Ben: tile keys never change, so cache hard). */
export const tileCacheKey = (revisionId: string, t: TileKey) =>
  `${revisionId}/${t.z}/${t.x}/${t.y}`;

/** Fills a `{z}/{x}/{y}` template from the tiles endpoint. */
export const tileUrl = (template: string, t: TileKey) =>
  template.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y));
