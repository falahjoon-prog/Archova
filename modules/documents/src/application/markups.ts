import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { MarkupVisibility } from '@archova/markup';
import { AppError, versionConflict, type TenantScope } from '@archova/kernel';
import { canSeeMarkup, invalidShape, type StoredShape } from '../domain/markup';
import { drawingMarkups } from '../infra/tables';
import type { DocumentsContext } from './context';
import type { DrawingService } from './drawings';

type MarkupRow = typeof drawingMarkups.$inferSelect;

export function createMarkupService(c: DocumentsContext, drawings: DrawingService) {
  function checkShapes(shapes: StoredShape[]) {
    const bad = invalidShape(shapes);
    if (bad)
      throw new AppError('markup.invalid_shape', bad.reason, [
        { path: `shapes/${bad.index}`, message: bad.reason },
      ]);
  }

  async function list(scope: TenantScope, projectId: string, revisionId: string) {
    await drawings.getRevision(scope, projectId, revisionId);
    const v = await c.viewer(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(drawingMarkups)
      .where(and(eq(drawingMarkups.revisionId, revisionId), isNull(drawingMarkups.deletedAt)))
      .orderBy(asc(drawingMarkups.id));
    return rows.filter((m) => canSeeMarkup(m, v));
  }

  async function create(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    input: { id?: string; visibility?: MarkupVisibility; shapes: StoredShape[] },
  ) {
    const revision = await drawings.getRevision(scope, projectId, revisionId);
    if (revision.status === 'draft') throw new AppError('drawing_revision.not_found');
    checkShapes(input.shapes);
    const visibility = input.visibility ?? 'private';
    if (visibility === 'project')
      await c.access.assert(scope, 'documents.markups.publish', { projectId });
    const v = await c.viewer(scope, projectId);
    if (visibility === 'company' && !v.companyId)
      throw new AppError(
        'markup.company_required',
        'Company markups need you to be on the project with a company.',
      );
    const id = input.id ?? uuidv7();
    const now = new Date();
    const [row] = await scope.tx
      .insert(drawingMarkups)
      .values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        revisionId,
        ownerId: scope.ctx.userId,
        ownerCompanyId: v.companyId,
        visibility,
        shapes: input.shapes,
        publishedAt: visibility === 'project' ? now : null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await changed(scope, projectId, row!);
    if (visibility === 'project') published(scope, projectId, row!);
    return row!;
  }

  async function getOwn(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    markupId: string,
  ) {
    const [row] = await scope.tx
      .select()
      .from(drawingMarkups)
      .where(
        and(
          eq(drawingMarkups.id, markupId),
          eq(drawingMarkups.revisionId, revisionId),
          eq(drawingMarkups.projectId, projectId),
          isNull(drawingMarkups.deletedAt),
        ),
      )
      .limit(1);
    const v = { userId: scope.ctx.userId, companyId: (await c.viewer(scope, projectId)).companyId };
    if (!row || !canSeeMarkup(row, v)) throw new AppError('markup.not_found');
    return row;
  }

  /**
   * The author edits their own markup. Publishing to the project is one-way (DOC-AC7); after that only the
   * "check location" flag of a carried-forward markup can be cleared, by anyone who may publish markups.
   */
  async function update(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    markupId: string,
    expectedVersion: number,
    patch: { visibility?: MarkupVisibility; shapes?: StoredShape[]; locationConfirmed?: boolean },
  ) {
    const current = await getOwn(scope, projectId, revisionId, markupId);
    if (current.version !== expectedVersion) throw versionConflict();
    const values: Partial<typeof drawingMarkups.$inferInsert> = {
      updatedBy: scope.ctx.userId,
      version: current.version + 1,
    };
    let publishing = false;
    if (current.visibility === 'project') {
      if (patch.shapes !== undefined || (patch.visibility && patch.visibility !== 'project'))
        throw new AppError('markup.published', 'Published markups are part of the record.');
      if (patch.locationConfirmed) {
        await c.access.assert(scope, 'documents.markups.publish', { projectId });
        values.needsLocationCheck = false;
      }
    } else {
      if (current.ownerId !== scope.ctx.userId)
        throw new AppError('markup.not_owner', 'Only the author can change this markup.');
      if (patch.shapes !== undefined) {
        checkShapes(patch.shapes);
        values.shapes = patch.shapes;
      }
      if (patch.visibility !== undefined && patch.visibility !== current.visibility) {
        if (patch.visibility === 'project') {
          await c.access.assert(scope, 'documents.markups.publish', { projectId });
          values.publishedAt = new Date();
          publishing = true;
        }
        if (patch.visibility === 'company' && !current.ownerCompanyId)
          throw new AppError(
            'markup.company_required',
            'Company markups need you to be on the project with a company.',
          );
        values.visibility = patch.visibility;
      }
      if (patch.locationConfirmed) values.needsLocationCheck = false;
    }
    const [row] = await scope.tx
      .update(drawingMarkups)
      .set(values)
      .where(and(eq(drawingMarkups.id, markupId), eq(drawingMarkups.version, expectedVersion)))
      .returning();
    if (!row) throw versionConflict();
    await changed(scope, projectId, row);
    if (publishing) published(scope, projectId, row);
    return row;
  }

  async function remove(
    scope: TenantScope,
    projectId: string,
    revisionId: string,
    markupId: string,
    expectedVersion: number,
  ) {
    const current = await getOwn(scope, projectId, revisionId, markupId);
    if (current.visibility === 'project')
      throw new AppError('markup.published', 'Published markups are part of the record.');
    if (current.ownerId !== scope.ctx.userId)
      throw new AppError('markup.not_owner', 'Only the author can delete this markup.');
    if (current.version !== expectedVersion) throw versionConflict();
    await scope.tx
      .update(drawingMarkups)
      .set({ deletedAt: new Date(), updatedBy: scope.ctx.userId, version: current.version + 1 })
      .where(eq(drawingMarkups.id, markupId));
    await scope.recordChange({
      module: 'drawings',
      entityType: 'drawing_markup',
      entityId: markupId,
      op: 'delete',
      version: current.version + 1,
      projectId,
      ...syncScope(current),
    });
  }

  /** Markups among `ids` on a project the caller may see (own, own company's, published), for the mobile pull. */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const v = await c.viewer(scope, projectId);
    const rows = await scope.tx
      .select()
      .from(drawingMarkups)
      .where(
        and(
          eq(drawingMarkups.projectId, projectId),
          inArray(drawingMarkups.id, [...ids]),
          isNull(drawingMarkups.deletedAt),
        ),
      );
    return rows.filter((m) => canSeeMarkup(m, v));
  }

  /** Where a markup lives, for a queued command that carries only the markup's id; null when it is gone. */
  async function locate(scope: TenantScope, markupId: string) {
    const [row] = await scope.tx
      .select({
        projectId: drawingMarkups.projectId,
        revisionId: drawingMarkups.revisionId,
        version: drawingMarkups.version,
      })
      .from(drawingMarkups)
      .where(and(eq(drawingMarkups.id, markupId), isNull(drawingMarkups.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  return { list, create, update, remove, getOwn, visibleAmong, locate };
}

/** Private and company markups only sync to the people who can see them. */
function syncScope(m: MarkupRow) {
  return {
    isPrivate: m.visibility === 'private',
    scopeCompanyId: m.visibility === 'company' ? m.ownerCompanyId : null,
  };
}

async function changed(scope: TenantScope, projectId: string, m: MarkupRow) {
  await scope.recordChange({
    module: 'drawings',
    entityType: 'drawing_markup',
    entityId: m.id,
    op: 'upsert',
    version: m.version,
    projectId,
    ...syncScope(m),
  });
}

/** Publishing is a deliberate act that lands in the audit log (DOC-AC7). */
function published(scope: TenantScope, projectId: string, m: MarkupRow) {
  scope.events.add({
    type: 'documents.markup.published.v1',
    projectId,
    entityType: 'drawing_markup',
    entityId: m.id,
    entityVersion: m.version,
    data: { markupId: m.id, revisionId: m.revisionId, shapeCount: m.shapes.length },
  });
}

export type MarkupService = ReturnType<typeof createMarkupService>;
