// Drawing sheets saved on the device so they open with no signal (mobile 03 §3.3, 02 §2.8). A sheet is kept as its
// overview image plus the low-resolution levels of its tile pyramid, as many as fit a tile budget; sharper levels
// load from the network when there is one. Tiles never change once built (Ben), so a saved sheet is never stale.

import type { SqlDatabase } from '../db';

/** A native file area for saved sheets, injected so the cache runs in Node tests. */
export interface SheetFiles {
  /** Folder everything lives under, ending in `/`. */
  root: string;
  /** Downloads `url` to `to` (creating folders). Returns the byte size, or null if it failed. */
  download(url: string, to: string): Promise<number | null>;
  /** Deletes a file or folder; missing is fine. */
  remove(path: string): Promise<void>;
}

export interface SheetPyramid {
  width: number;
  height: number;
  tileSize: number;
  levels: number;
}

export interface SheetTiles extends SheetPyramid {
  overviewUrl: string | undefined;
  /** Contains `{z}`, `{x}` and `{y}`. */
  tileUrlTemplate: string;
}

export interface SavedSheet extends SheetPyramid {
  revisionId: string;
  projectId: string;
  /** Highest pyramid level held on the device; levels above it come from the network. */
  cachedLevel: number;
  bytes: number;
  cachedAt: string;
}

export const DEFAULT_TILE_BUDGET = 600;
export const DEFAULT_CACHE_LIMIT_BYTES = 500_000_000;

/** Tiles in level `z` (level `levels - 1` is full resolution; each lower level halves both sides). */
export function tilesAtLevel(p: SheetPyramid, z: number): { cols: number; rows: number } {
  const f = 2 ** (p.levels - 1 - z);
  return {
    cols: Math.ceil(Math.ceil(p.width / f) / p.tileSize),
    rows: Math.ceil(Math.ceil(p.height / f) / p.tileSize),
  };
}

/** The tiles to save: every level from 0 up to the highest one that keeps the total within `budget`. */
export function planTiles(p: SheetPyramid, budget = DEFAULT_TILE_BUDGET) {
  const tiles: { z: number; x: number; y: number }[] = [];
  let cachedLevel = -1;
  for (let z = 0; z < p.levels; z++) {
    const { cols, rows } = tilesAtLevel(p, z);
    if (tiles.length + cols * rows > budget && z > 0) break;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) tiles.push({ z, x, y });
    cachedLevel = z;
  }
  return { cachedLevel, tiles };
}

export const overviewPath = (root: string, revisionId: string) =>
  `${root}${revisionId}/overview.img`;
export const tilePath = (
  root: string,
  revisionId: string,
  k: { z: number; x: number; y: number },
) => `${root}${revisionId}/${k.z}/${k.x}_${k.y}.img`;

interface Row {
  revision_id: string;
  project_id: string;
  width: number;
  height: number;
  tile_size: number;
  levels: number;
  cached_level: number;
  bytes: number;
  cached_at: string;
}

const toSaved = (r: Row): SavedSheet => ({
  revisionId: r.revision_id,
  projectId: r.project_id,
  width: r.width,
  height: r.height,
  tileSize: r.tile_size,
  levels: r.levels,
  cachedLevel: r.cached_level,
  bytes: r.bytes,
  cachedAt: r.cached_at,
});

export class SheetCache {
  private readonly saving = new Set<string>();

  constructor(
    private readonly db: SqlDatabase,
    private readonly files: SheetFiles,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get root() {
    return this.files.root;
  }

  async get(revisionId: string): Promise<SavedSheet | null> {
    const row = await this.db.getFirstAsync<Row>(
      'SELECT * FROM sheet_cache WHERE revision_id = ?',
      [revisionId],
    );
    return row ? toSaved(row) : null;
  }

  async savedRevisionIds(projectId: string): Promise<Set<string>> {
    const rows = await this.db.getAllAsync<{ revision_id: string }>(
      'SELECT revision_id FROM sheet_cache WHERE project_id = ?',
      [projectId],
    );
    return new Set(rows.map((r) => r.revision_id));
  }

  async bytesFor(projectId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number | null }>(
      'SELECT SUM(bytes) AS n FROM sheet_cache WHERE project_id = ?',
      [projectId],
    );
    return row?.n ?? 0;
  }

  /**
   * Save a sheet from a fresh tiles response. Does nothing if it is already saved or being saved. The record is
   * written only when the overview and every planned tile arrived, so a half-saved sheet is never trusted; files
   * from a failed attempt are removed. Returns true when the sheet is saved.
   */
  async save(
    projectId: string,
    revisionId: string,
    tiles: SheetTiles,
    budget = DEFAULT_TILE_BUDGET,
  ): Promise<boolean> {
    if (this.saving.has(revisionId)) return false;
    if (await this.get(revisionId)) return true;
    this.saving.add(revisionId);
    try {
      let bytes = 0;
      if (tiles.overviewUrl) {
        const size = await this.files.download(
          tiles.overviewUrl,
          overviewPath(this.files.root, revisionId),
        );
        if (size === null) return await this.abandon(revisionId);
        bytes += size;
      }
      const plan = planTiles(tiles, budget);
      for (const k of plan.tiles) {
        const url = tiles.tileUrlTemplate
          .replace('{z}', String(k.z))
          .replace('{x}', String(k.x))
          .replace('{y}', String(k.y));
        const size = await this.files.download(url, tilePath(this.files.root, revisionId, k));
        if (size === null) return await this.abandon(revisionId);
        bytes += size;
      }
      await this.db.runAsync(
        `INSERT OR REPLACE INTO sheet_cache
           (revision_id, project_id, width, height, tile_size, levels, cached_level, bytes, cached_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          revisionId,
          projectId,
          tiles.width,
          tiles.height,
          tiles.tileSize,
          tiles.levels,
          plan.cachedLevel,
          bytes,
          this.now().toISOString(),
        ],
      );
      return true;
    } finally {
      this.saving.delete(revisionId);
    }
  }

  private async abandon(revisionId: string): Promise<false> {
    await this.files.remove(`${this.files.root}${revisionId}/`);
    return false;
  }

  async remove(revisionId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM sheet_cache WHERE revision_id = ?', [revisionId]);
    await this.files.remove(`${this.files.root}${revisionId}/`);
  }

  async removeProject(projectId: string): Promise<void> {
    const rows = await this.db.getAllAsync<{ revision_id: string }>(
      'SELECT revision_id FROM sheet_cache WHERE project_id = ?',
      [projectId],
    );
    for (const r of rows) await this.remove(r.revision_id);
  }

  /** Drop the oldest saved sheets until the total is within `maxBytes`, never the one just opened. */
  async evict(maxBytes = DEFAULT_CACHE_LIMIT_BYTES, keepRevisionId?: string): Promise<number> {
    const rows = await this.db.getAllAsync<Row>('SELECT * FROM sheet_cache ORDER BY cached_at');
    let total = rows.reduce((n, r) => n + r.bytes, 0);
    let dropped = 0;
    for (const r of rows) {
      if (total <= maxBytes) break;
      if (r.revision_id === keepRevisionId) continue;
      await this.remove(r.revision_id);
      total -= r.bytes;
      dropped++;
    }
    return dropped;
  }
}
