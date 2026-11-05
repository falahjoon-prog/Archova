import { describe, expect, it } from 'vitest';
import { migrate } from '../lib/db';
import {
  overviewPath,
  planTiles,
  SheetCache,
  tilePath,
  tilesAtLevel,
  type SheetFiles,
  type SheetTiles,
} from '../lib/files/sheet-cache';
import { nodeSqlDriver } from './support/node-sql';

// A 1000 x 600 sheet with 256 px tiles over 3 levels: level 0 = 250 x 150 (1 tile), 1 = 500 x 300 (2 x 2 = 4),
// 2 = 1000 x 600 (4 x 3 = 12).
const pyramid = { width: 1000, height: 600, tileSize: 256, levels: 3 };
const tiles: SheetTiles = {
  ...pyramid,
  overviewUrl: 'https://cdn/o.webp',
  tileUrlTemplate: 'https://cdn/{z}/{x}/{y}.webp',
};

function fakeFiles(fail: (url: string) => boolean = () => false) {
  const downloaded: string[] = [];
  const removed: string[] = [];
  const files: SheetFiles = {
    root: 'file:///docs/drawings/',
    async download(url, to) {
      if (fail(url)) return null;
      downloaded.push(`${url} -> ${to}`);
      return 1000;
    },
    async remove(path) {
      removed.push(path);
    },
  };
  return { files, downloaded, removed };
}

async function setup(fail?: (url: string) => boolean) {
  const db = await nodeSqlDriver().open('sheets.db');
  await migrate(db);
  const f = fakeFiles(fail);
  let n = 0;
  const cache = new SheetCache(db, f.files, () => new Date(Date.UTC(2026, 10, 5, 0, 0, n++)));
  return { cache, ...f };
}

describe('planTiles', () => {
  it('counts tiles per level', () => {
    expect(tilesAtLevel(pyramid, 0)).toEqual({ cols: 1, rows: 1 });
    expect(tilesAtLevel(pyramid, 1)).toEqual({ cols: 2, rows: 2 });
    expect(tilesAtLevel(pyramid, 2)).toEqual({ cols: 4, rows: 3 });
  });

  it('takes every level that fits the budget, lowest first', () => {
    expect(planTiles(pyramid, 600).cachedLevel).toBe(2);
    expect(planTiles(pyramid, 600).tiles).toHaveLength(1 + 4 + 12);
    const small = planTiles(pyramid, 6);
    expect(small.cachedLevel).toBe(1);
    expect(small.tiles).toHaveLength(5);
  });

  it('always keeps level 0 even over budget', () => {
    expect(planTiles(pyramid, 0)).toMatchObject({ cachedLevel: 0 });
  });
});

describe('SheetCache', () => {
  it('saves the overview and planned tiles, then reports the sheet as saved', async () => {
    const { cache, downloaded } = await setup();
    expect(await cache.save('prj_1', 'rev_1', tiles, 6)).toBe(true);
    expect(downloaded[0]).toBe(
      `https://cdn/o.webp -> ${overviewPath('file:///docs/drawings/', 'rev_1')}`,
    );
    expect(downloaded).toContain(
      `https://cdn/1/1/0.webp -> ${tilePath('file:///docs/drawings/', 'rev_1', { z: 1, x: 1, y: 0 })}`,
    );
    expect(downloaded).toHaveLength(1 + 5);
    const saved = await cache.get('rev_1');
    expect(saved).toMatchObject({ projectId: 'prj_1', cachedLevel: 1, bytes: 6000, levels: 3 });
    expect([...(await cache.savedRevisionIds('prj_1'))]).toEqual(['rev_1']);
    expect(await cache.bytesFor('prj_1')).toBe(6000);
    // Saving again does not download again.
    expect(await cache.save('prj_1', 'rev_1', tiles, 6)).toBe(true);
    expect(downloaded).toHaveLength(6);
  });

  it('does not trust a half-saved sheet and cleans up its files', async () => {
    const { cache, removed } = await setup((url) => url.endsWith('/1/1/1.webp'));
    expect(await cache.save('prj_1', 'rev_1', tiles, 6)).toBe(false);
    expect(await cache.get('rev_1')).toBeNull();
    expect(removed).toContain('file:///docs/drawings/rev_1/');
  });

  it('removes a project and evicts the oldest sheets over the limit, but never the open one', async () => {
    const { cache, removed } = await setup();
    await cache.save('prj_1', 'rev_a', tiles, 1);
    await cache.save('prj_1', 'rev_b', tiles, 1);
    await cache.save('prj_2', 'rev_c', tiles, 1);
    expect(await cache.evict(4000, 'rev_a')).toBe(1);
    expect(await cache.get('rev_a')).not.toBeNull();
    expect(await cache.get('rev_b')).toBeNull();
    await cache.removeProject('prj_1');
    expect(await cache.get('rev_a')).toBeNull();
    expect(await cache.get('rev_c')).not.toBeNull();
    expect(removed).toContain('file:///docs/drawings/rev_a/');
  });
});
