/** The dashboard grid: 12 columns, rows of a fixed height. Pure helpers so the board and the tests share one set of rules. */
export const COLS = 12;

export interface Tile {
  id: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config?: Record<string, unknown>;
}

const hit = (a: Tile, b: Tile) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Lay tiles out without overlaps: the pinned tile (the one being dragged or resized) stays where it is, every other tile
 * rises as far as it can and drops below whatever it would overlap. The array keeps its original order.
 */
export function settle(tiles: readonly Tile[], pinnedId?: string): Tile[] {
  const pinned = tiles.find((t) => t.id === pinnedId);
  const rest = tiles.filter((t) => t.id !== pinnedId).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: Tile[] = pinned ? [pinned] : [];
  for (const t of rest) {
    let c: Tile = { ...t, y: 0 };
    while (placed.some((p) => hit(p, c))) c = { ...c, y: c.y + 1 };
    placed.push(c);
  }
  return tiles.map((t) => placed.find((p) => p.id === t.id)!);
}

export function moveTile(tiles: readonly Tile[], id: string, x: number, y: number): Tile[] {
  return settle(
    tiles.map((t) =>
      t.id === id ? { ...t, x: Math.min(Math.max(0, x), COLS - t.w), y: Math.max(0, y) } : t,
    ),
    id,
  );
}

export function resizeTile(
  tiles: readonly Tile[],
  id: string,
  w: number,
  h: number,
  min: { w: number; h: number } = { w: 1, h: 1 },
): Tile[] {
  return settle(
    tiles.map((t) =>
      t.id === id
        ? {
            ...t,
            w: Math.min(Math.max(min.w, w), COLS - t.x),
            h: Math.min(Math.max(min.h, h), 40),
          }
        : t,
    ),
    id,
  );
}

/** A new tile goes at the bottom, full left. */
export function addTile(tiles: readonly Tile[], tile: Omit<Tile, 'x' | 'y'>): Tile[] {
  const y = tiles.reduce((m, t) => Math.max(m, t.y + t.h), 0);
  return [...tiles, { ...tile, x: 0, y }];
}

export function newTileId(tiles: readonly Tile[]): string {
  let n = tiles.length + 1;
  while (tiles.some((t) => t.id === `t${n}`)) n++;
  return `t${n}`;
}

/** Tiles in reading order, for narrow screens where the grid becomes one column. */
export const readingOrder = (tiles: readonly Tile[]) =>
  [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
