import { eq } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { sheetGeometry } from '../infra/tables';
import type { DrawingService } from './drawings';

export type SheetGeometryRow = typeof sheetGeometry.$inferSelect;

/** What the files worker read off a sheet (backend 06 §5). */
export interface ExtractedGeometry {
  geometryKey: string;
  extractorVersion: string;
  scaleDetected?: number | null;
}

export function createGeometryService(drawings: DrawingService) {
  const now = () => new Date();

  async function find(scope: TenantScope, revisionId: string) {
    const [row] = await scope.tx
      .select()
      .from(sheetGeometry)
      .where(eq(sheetGeometry.revisionId, revisionId))
      .limit(1);
    return row ?? null;
  }

  /** A published revision's geometry state; before the worker runs it is simply "pending" with no scale. */
  async function get(scope: TenantScope, projectId: string, revisionId: string) {
    const revision = await drawings.getRevision(scope, projectId, revisionId);
    if (revision.status === 'draft') throw new AppError('drawing_revision.not_found');
    return { revisionId, row: await find(scope, revisionId) };
  }

  async function ensure(scope: TenantScope, projectId: string, revisionId: string) {
    const existing = await find(scope, revisionId);
    if (existing) return existing;
    const [created] = await scope.tx
      .insert(sheetGeometry)
      .values({ id: uuidv7(), orgId: scope.ctx.orgId, projectId, revisionId })
      .onConflictDoNothing()
      .returning();
    return created ?? (await find(scope, revisionId))!;
  }

  /** A person fixes the drawing scale the takeoff tools measure against (X30). */
  async function confirmScale(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    ratio: number,
    expected: number | null,
  ) {
    await get(scope, projectId, revisionId);
    const row = await ensure(scope, projectId, revisionId);
    if (expected !== null && row.version !== expected) throw versionConflict();
    const [updated] = await scope.tx
      .update(sheetGeometry)
      .set({
        scaleConfirmed: ratio,
        scaleConfirmedBy: scope.ctx.userId,
        scaleConfirmedAt: now(),
        version: row.version + 1,
        updatedAt: now(),
      })
      .where(eq(sheetGeometry.id, row.id))
      .returning();
    scope.events.add({
      type: 'documents.sheet.scale_confirmed.v1',
      projectId,
      entityType: 'sheet_geometry',
      entityId: row.id,
      entityVersion: updated!.version,
      data: { revisionId, scale: ratio },
    });
    return updated!;
  }

  /** The files worker records extracted geometry; it never touches a scale a person confirmed. */
  async function recordExtracted(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    input: ExtractedGeometry,
  ) {
    await drawings.getRevision(scope, projectId, revisionId);
    const row = await ensure(scope, projectId, revisionId);
    const [updated] = await scope.tx
      .update(sheetGeometry)
      .set({
        geometryKey: input.geometryKey,
        extractorVersion: input.extractorVersion,
        extractedAt: now(),
        scaleDetected: input.scaleDetected ?? null,
        version: row.version + 1,
        updatedAt: now(),
      })
      .where(eq(sheetGeometry.id, row.id))
      .returning();
    scope.events.add({
      type: 'documents.sheet.geometry_ready.v1',
      projectId,
      entityType: 'sheet_geometry',
      entityId: row.id,
      entityVersion: updated!.version,
      data: { revisionId, scaleDetected: input.scaleDetected ?? null },
    });
    return updated!;
  }

  return { get, confirmScale, recordExtracted };
}

export type GeometryService = ReturnType<typeof createGeometryService>;
