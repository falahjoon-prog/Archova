import { eq } from 'drizzle-orm';
import { AppError, type TenantScope } from '@archova/kernel';
import { drawingRevisions } from '../infra/tables';
import type { DrawingService } from './drawings';

export const TILE_SIZE = 256;
/** Tile keys never change once written, so the template can live for hours. */
const TEMPLATE_TTL_S = 6 * 3600;
const MAX_SIDE_PX = 200_000;

export interface Tiles {
  signTiles(
    prefix: string,
    o: { expiresInS: number },
  ): Promise<{ tileUrlTemplate: string; overviewUrl: string; expiresAt: Date }>;
}

/** Zoom levels in a pyramid whose top level fits one tile: 0 is the overview, `levels - 1` is full resolution. */
export function levelsFor(widthPx: number, heightPx: number): number {
  const longest = Math.max(widthPx, heightPx);
  return longest <= TILE_SIZE ? 1 : Math.ceil(Math.log2(longest / TILE_SIZE)) + 1;
}

export type TileService = ReturnType<typeof createTileService>;

export function createTileService(drawings: DrawingService, tiles: Tiles) {
  /** Where a sheet's tiles are, with a signed template; "pending" until the files worker has cut them. */
  async function get(scope: TenantScope, projectId: string, revisionId: string) {
    const revision = await drawings.getRevision(scope, projectId, revisionId);
    if (revision.status === 'draft') throw new AppError('drawing_revision.not_found');
    if (!revision.tilesPrefix || !revision.widthPx || !revision.heightPx)
      return { status: 'pending' as const };
    const signed = await tiles.signTiles(revision.tilesPrefix, { expiresInS: TEMPLATE_TTL_S });
    return {
      status: 'ready' as const,
      width: revision.widthPx,
      height: revision.heightPx,
      tileSize: TILE_SIZE,
      levels: levelsFor(revision.widthPx, revision.heightPx),
      ...signed,
    };
  }

  /** The files worker records a finished pyramid (backend 06 §4). The prefix must sit under this project. */
  async function recordTiles(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    input: { prefix: string; widthPx: number; heightPx: number },
  ) {
    await drawings.getRevision(scope, projectId, revisionId);
    // Exactly one revision's folder: the signature is a wildcard under this prefix, so a shorter prefix (or a `*`
    // or `?` in it) would sign more than this sheet's tiles.
    const expected = `orgs/${scope.ctx.orgId}/projects/${projectId}/tiles/${revisionId}`;
    const valid =
      input.prefix === expected &&
      Number.isInteger(input.widthPx) &&
      Number.isInteger(input.heightPx) &&
      input.widthPx > 0 &&
      input.heightPx > 0 &&
      input.widthPx <= MAX_SIDE_PX &&
      input.heightPx <= MAX_SIDE_PX;
    if (!valid) throw new AppError('drawing_tiles.invalid');
    await scope.tx
      .update(drawingRevisions)
      .set({
        tilesPrefix: input.prefix,
        widthPx: input.widthPx,
        heightPx: input.heightPx,
        updatedAt: new Date(),
      })
      .where(eq(drawingRevisions.id, revisionId));
    scope.events.add({
      type: 'documents.drawing.tiles_ready.v1',
      projectId,
      entityType: 'drawing_revision',
      entityId: revisionId,
      data: { revisionId, widthPx: input.widthPx, heightPx: input.heightPx },
    });
  }

  return { get, recordTiles };
}
