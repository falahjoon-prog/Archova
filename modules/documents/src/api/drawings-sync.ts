import { encodeId } from '@archova/domain';
import type { SyncSource } from '@archova/kernel';
import type { DrawingService } from '../application/drawings';
import { toDrawingRevisionDto, toDrawingSheetDto } from './mappers';

/**
 * Drawing sheets (with their current revision) and published revisions for the mobile pull. A separate sync module
 * from `documents` because reading drawings is its own permission (`documents.drawings.read`).
 */
export function createDrawingsSyncSource(
  drawings: Pick<DrawingService, 'sheetsAmong' | 'publishedRevisionsAmong'>,
): SyncSource {
  return {
    module: 'drawings',
    permission: 'documents.drawings.read',
    publicId: (entityType, id) =>
      encodeId(entityType === 'drawing_revision' ? 'drawingRevision' : 'drawingSheet', id),
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
      }
      return out;
    },
  };
}
