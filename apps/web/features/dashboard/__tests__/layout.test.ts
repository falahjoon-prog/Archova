import { describe, expect, it } from 'vitest';
import {
  addTile,
  moveTile,
  newTileId,
  readingOrder,
  resizeTile,
  settle,
  type Tile,
} from '../lib/layout';

const t = (id: string, x: number, y: number, w = 3, h = 2): Tile => ({
  id,
  type: 'text_box',
  x,
  y,
  w,
  h,
});

describe('dashboard layout', () => {
  it('moves a tile and makes the one it lands on drop below', () => {
    const out = moveTile([t('a', 0, 0), t('b', 3, 0)], 'a', 3, 0);
    expect(out.find((x) => x.id === 'a')).toMatchObject({ x: 3, y: 0 });
    expect(out.find((x) => x.id === 'b')).toMatchObject({ x: 3, y: 2 });
  });

  it('keeps a moved tile inside the 12 columns', () => {
    expect(moveTile([t('a', 0, 0)], 'a', 40, -3)[0]).toMatchObject({ x: 9, y: 0 });
  });

  it('closes gaps by lifting tiles up', () => {
    const out = settle([t('a', 0, 0), t('b', 0, 9)]);
    expect(out[1]).toMatchObject({ y: 2 });
  });

  it('resizes within the grid and the tile minimum', () => {
    const out = resizeTile([t('a', 6, 0)], 'a', 20, 0, { w: 2, h: 2 });
    expect(out[0]).toMatchObject({ w: 6, h: 2 });
  });

  it('adds a tile at the bottom with a fresh id and reads in row order', () => {
    const base = [t('t1', 0, 0), t('t2', 3, 0)];
    const out = addTile(base, { id: newTileId(base), type: 'text_box', w: 4, h: 3 });
    expect(out[2]).toMatchObject({ id: 't3', x: 0, y: 2 });
    expect(readingOrder([t('b', 3, 0), t('a', 0, 0)]).map((x) => x.id)).toEqual(['a', 'b']);
  });
});
