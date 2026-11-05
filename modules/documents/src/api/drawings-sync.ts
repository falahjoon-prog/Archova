import { decodeId, encodeId } from '@archova/domain';
import { AppError, type SyncCommand, type SyncSource } from '@archova/kernel';
import type { MarkupVisibility } from '@archova/markup';
import type { DrawingService } from '../application/drawings';
import type { MarkupService } from '../application/markups';
import type { StoredShape } from '../domain/markup';
import { toDrawingRevisionDto, toDrawingSheetDto, toMarkupDto } from './mappers';

/**
 * Drawing sheets (with their current revision) and published revisions for the mobile pull. A separate sync module
 * from `documents` because reading drawings is its own permission (`documents.drawings.read`).
 */
export function createDrawingsSyncSource(
  drawings: Pick<DrawingService, 'sheetsAmong' | 'publishedRevisionsAmong'>,
  markups: Pick<MarkupService, 'visibleAmong'>,
): SyncSource {
  return {
    module: 'drawings',
    permission: 'documents.drawings.read',
    publicId: (entityType, id) =>
      encodeId(
        entityType === 'drawing_revision'
          ? 'drawingRevision'
          : entityType === 'drawing_markup'
            ? 'markup'
            : 'drawingSheet',
        id,
      ),
    async load(scope, { projectId, entityType, ids }) {
      const out = new Map<string, { version: number; data: Record<string, unknown> }>();
      if (!projectId) return out;
      if (entityType === 'drawing_sheet') {
        for (const row of await drawings.sheetsAmong(scope, projectId, ids))
          out.set(row.sheet.id, {
            version: row.sheet.version,
            data: toDrawingSheetDto(row) as unknown as Record<string, unknown>,
          });
      } else if (entityType === 'drawing_revision') {
        for (const r of await drawings.publishedRevisionsAmong(scope, projectId, ids))
          out.set(r.id, {
            version: r.version,
            data: toDrawingRevisionDto(r) as unknown as Record<string, unknown>,
          });
      } else if (entityType === 'drawing_markup') {
        for (const m of await markups.visibleAmong(scope, projectId, ids))
          out.set(m.id, {
            version: m.version,
            data: toMarkupDto(m) as unknown as Record<string, unknown>,
          });
      }
      return out;
    },
  };
}

const invalid = (path: string, message: string) =>
  new AppError('validation_failed', message, [{ path, message }]);

const VISIBILITIES: readonly MarkupVisibility[] = ['private', 'company', 'project'];
const MAX_SHAPES = 2000;

/**
 * `drawings.createMarkup`: the REST "add a markup" call queued offline. The device picks the markup's id, so the
 * record it already shows is the one the next pull confirms. The same service call applies the revision, visibility
 * and shape checks, so a markup is judged exactly as it would be online.
 */
export function createMarkupCommand(
  drawings: Pick<DrawingService, 'projectOfRevision'>,
  markups: Pick<MarkupService, 'create'>,
): SyncCommand {
  return {
    name: 'drawings.createMarkup',
    module: 'documents',
    async run(scope, m) {
      const markupId = typeof m.entityId === 'string' ? decodeId('markup', m.entityId) : null;
      if (!markupId) throw invalid('entityId', 'Invalid id');
      const p = m.payload;
      const revisionId =
        typeof p.revisionId === 'string' ? decodeId('drawingRevision', p.revisionId) : null;
      if (!revisionId) throw invalid('payload/revisionId', 'Invalid id');
      const visibility = (p.visibility ?? 'private') as MarkupVisibility;
      if (!VISIBILITIES.includes(visibility))
        throw invalid('payload/visibility', 'Invalid visibility');
      if (!Array.isArray(p.shapes) || p.shapes.length === 0 || p.shapes.length > MAX_SHAPES)
        throw invalid('payload/shapes', `Send between 1 and ${MAX_SHAPES} shapes`);
      const projectId = await drawings.projectOfRevision(scope, revisionId);
      if (!projectId) throw new AppError('drawing_revision.not_found');
      const row = await markups.create(scope, projectId, revisionId, {
        id: markupId,
        visibility,
        shapes: p.shapes as StoredShape[],
      });
      return { version: row.version };
    },
    // A create has no earlier copy to conflict with.
    async current() {
      return null;
    },
  };
}
