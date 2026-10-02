import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { encodeId, uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import {
  findPublishConflicts,
  normaliseSheetNumber,
  unresolvedConflicts,
  type ExistingSheet,
  type PublishConflict,
} from '../domain/publish';
import {
  drawingMarkups,
  drawingRevisions,
  drawingSets,
  drawingSheets,
  type IssuedFor,
} from '../infra/tables';
import type { DocumentsContext } from './context';

type SetRow = typeof drawingSets.$inferSelect;
type RevisionRow = typeof drawingRevisions.$inferSelect;
type SheetRow = typeof drawingSheets.$inferSelect;

export interface DraftInput {
  sheetNumber: string;
  title: string;
  discipline?: string | null;
  rev: string;
  issuedFor?: IssuedFor | null;
  fileId: string;
  pageIndex?: number;
  drawingDate?: string | null;
}

/** A revision with what the superseded banner needs (DOC-AC6). */
export type RevisionView = RevisionRow & { successor: { id: string; rev: string } | null };

export function createDrawingService(c: DocumentsContext) {
  async function getSet(scope: TenantScope, projectId: string, setId: string) {
    const [row] = await scope.tx
      .select()
      .from(drawingSets)
      .where(and(eq(drawingSets.id, setId), eq(drawingSets.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('drawing_set.not_found');
    return row;
  }

  function assertOpen(set: SetRow) {
    if (set.status === 'published')
      throw new AppError('drawing_set.already_published', 'This set has already been published.');
  }

  async function listSets(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    await c.requireProject(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(drawingSets.projectId, projectId)];
    if (after) conditions.push(lt(drawingSets.id, after.id));
    const rows = await scope.tx
      .select()
      .from(drawingSets)
      .where(and(...conditions))
      .orderBy(desc(drawingSets.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ id: r.id }));
  }

  async function createSet(
    scope: TenantScope,
    projectId: string,
    input: { name: string; issuedDate?: string; receivedDate?: string },
  ) {
    await c.requireProject(scope, projectId);
    const [row] = await scope.tx
      .insert(drawingSets)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        name: input.name.trim(),
        issuedDate: input.issuedDate ?? null,
        receivedDate: input.receivedDate ?? null,
        status: 'review',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return row!;
  }

  async function setRevisions(scope: TenantScope, setId: string) {
    return scope.tx
      .select()
      .from(drawingRevisions)
      .where(eq(drawingRevisions.setId, setId))
      .orderBy(asc(drawingRevisions.sheetNumber), asc(drawingRevisions.id));
  }

  /** What the register holds for each sheet number in `numbers`: current revision and every published rev. */
  async function existingSheets(scope: TenantScope, projectId: string, numbers: string[]) {
    const map = new Map<string, ExistingSheet & { sheet: SheetRow; currentId: string | null }>();
    if (!numbers.length) return map;
    const sheets = await scope.tx
      .select()
      .from(drawingSheets)
      .where(
        and(eq(drawingSheets.projectId, projectId), inArray(drawingSheets.sheetNumber, numbers)),
      );
    if (!sheets.length) return map;
    const revs = await scope.tx
      .select({
        sheetId: drawingRevisions.sheetId,
        id: drawingRevisions.id,
        rev: drawingRevisions.rev,
      })
      .from(drawingRevisions)
      .where(
        and(
          inArray(
            drawingRevisions.sheetId,
            sheets.map((s) => s.id),
          ),
          inArray(drawingRevisions.status, ['current', 'superseded']),
        ),
      );
    for (const s of sheets) {
      const mine = revs.filter((r) => r.sheetId === s.id);
      map.set(s.sheetNumber, {
        sheet: s,
        currentId: s.currentRevisionId,
        currentRev: mine.find((r) => r.id === s.currentRevisionId)?.rev ?? null,
        revs: mine.map((r) => r.rev),
      });
    }
    return map;
  }

  async function conflictsFor(scope: TenantScope, projectId: string, drafts: RevisionRow[]) {
    const existing = await existingSheets(
      scope,
      projectId,
      drafts.map((d) => d.sheetNumber),
    );
    return { existing, conflicts: findPublishConflicts(drafts, existing) };
  }

  async function review(scope: TenantScope, projectId: string, setId: string) {
    const set = await getSet(scope, projectId, setId);
    const revisions = await setRevisions(scope, setId);
    const drafts = revisions.filter((r) => r.status === 'draft');
    const { conflicts } = await conflictsFor(scope, projectId, drafts);
    return { set, revisions: await withSuccessors(scope, revisions), conflicts };
  }

  async function addDraft(scope: TenantScope, projectId: string, setId: string, input: DraftInput) {
    const set = await getSet(scope, projectId, setId);
    assertOpen(set);
    await c.requireReadyFile(scope, projectId, input.fileId);
    const [row] = await scope.tx
      .insert(drawingRevisions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId,
        setId,
        sheetNumber: normaliseSheetNumber(input.sheetNumber),
        title: input.title.trim(),
        discipline: input.discipline ?? null,
        rev: input.rev.trim().toUpperCase(),
        issuedFor: input.issuedFor ?? null,
        fileId: input.fileId,
        pageIndex: input.pageIndex ?? 0,
        status: 'draft',
        drawingDate: input.drawingDate ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return { ...row!, successor: null };
  }

  async function getDraft(
    scope: TenantScope,
    projectId: string,
    setId: string,
    revisionId: string,
  ) {
    const set = await getSet(scope, projectId, setId);
    assertOpen(set);
    const [row] = await scope.tx
      .select()
      .from(drawingRevisions)
      .where(and(eq(drawingRevisions.id, revisionId), eq(drawingRevisions.setId, setId)))
      .limit(1);
    if (!row) throw new AppError('drawing_revision.not_found');
    if (row.status !== 'draft')
      throw new AppError('drawing_revision.not_draft', 'Published revisions cannot be changed.');
    return row;
  }

  async function updateDraft(
    scope: TenantScope,
    projectId: string,
    setId: string,
    revisionId: string,
    expectedVersion: number,
    patch: Partial<Omit<DraftInput, 'fileId'>>,
  ) {
    const current = await getDraft(scope, projectId, setId, revisionId);
    if (current.version !== expectedVersion) throw versionConflict();
    const values: Partial<typeof drawingRevisions.$inferInsert> = {
      updatedBy: scope.ctx.userId,
      version: current.version + 1,
    };
    if (patch.sheetNumber !== undefined)
      values.sheetNumber = normaliseSheetNumber(patch.sheetNumber);
    if (patch.title !== undefined) values.title = patch.title.trim();
    if (patch.discipline !== undefined) values.discipline = patch.discipline;
    if (patch.rev !== undefined) values.rev = patch.rev.trim().toUpperCase();
    if (patch.issuedFor !== undefined) values.issuedFor = patch.issuedFor;
    if (patch.pageIndex !== undefined) values.pageIndex = patch.pageIndex;
    if (patch.drawingDate !== undefined) values.drawingDate = patch.drawingDate;
    const [row] = await scope.tx
      .update(drawingRevisions)
      .set(values)
      .where(
        and(eq(drawingRevisions.id, revisionId), eq(drawingRevisions.version, expectedVersion)),
      )
      .returning();
    if (!row) throw versionConflict();
    return { ...row, successor: null };
  }

  async function removeDraft(
    scope: TenantScope,
    projectId: string,
    setId: string,
    revisionId: string,
  ) {
    await getDraft(scope, projectId, setId, revisionId);
    await scope.tx.delete(drawingRevisions).where(eq(drawingRevisions.id, revisionId));
  }

  /**
   * Publishes a set in one transaction (DOC-AC4): each draft becomes current, the sheet's previous current
   * revision is superseded, published markups are carried forward flagged "check location" (DOC-AC8), and one
   * `documents.drawing.revision.published.v1` event per sheet feeds the audit log, pins and AI.
   */
  async function publish(
    scope: TenantScope,
    projectId: string,
    setId: string,
    input: { confirmNewSheets: boolean; reasons: Map<string, string> },
  ) {
    const set = await getSet(scope, projectId, setId);
    assertOpen(set);
    const drafts = (await setRevisions(scope, setId)).filter((r) => r.status === 'draft');
    if (!drafts.length)
      throw new AppError('drawing_set.empty', 'Add at least one sheet to publish.');
    const { existing, conflicts } = await conflictsFor(scope, projectId, drafts);
    const open = unresolvedConflicts(conflicts, input);
    if (open.length) throw publishConflicts(open);
    const olderIds = new Set(
      conflicts.filter((x) => x.kind === 'older_than_current').map((x) => x.revisionId),
    );

    const now = new Date();
    for (const d of drafts) {
      const prior = existing.get(d.sheetNumber);
      let sheetId: string;
      if (prior) {
        sheetId = prior.sheet.id;
        if (prior.currentId) {
          await scope.tx
            .update(drawingRevisions)
            .set({
              status: 'superseded',
              supersededAt: now,
              supersededById: d.id,
              updatedBy: scope.ctx.userId,
              version: sqlIncrement(),
            })
            .where(eq(drawingRevisions.id, prior.currentId));
          await revisionChanged(scope, projectId, prior.currentId);
        }
      } else {
        sheetId = uuidv7();
        await scope.tx.insert(drawingSheets).values({
          id: sheetId,
          orgId: scope.ctx.orgId,
          projectId,
          sheetNumber: d.sheetNumber,
          title: d.title,
          discipline: d.discipline,
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        });
      }
      const [published] = await scope.tx
        .update(drawingRevisions)
        .set({
          sheetId,
          status: 'current',
          publishedAt: now,
          publishReason: olderIds.has(d.id) ? input.reasons.get(d.id)!.trim() : null,
          updatedBy: scope.ctx.userId,
          version: d.version + 1,
        })
        .where(eq(drawingRevisions.id, d.id))
        .returning();
      const [sheet] = await scope.tx
        .update(drawingSheets)
        .set({
          currentRevisionId: d.id,
          title: d.title,
          discipline: d.discipline,
          updatedBy: scope.ctx.userId,
          version: prior ? prior.sheet.version + 1 : 1,
        })
        .where(eq(drawingSheets.id, sheetId))
        .returning();
      if (prior?.currentId) await carryForwardMarkups(scope, projectId, prior.currentId, d.id);
      await scope.recordChange({
        module: 'documents',
        entityType: 'drawing_sheet',
        entityId: sheetId,
        op: 'upsert',
        version: sheet!.version,
        projectId,
      });
      await revisionChanged(scope, projectId, d.id, published!.version);
      scope.events.add({
        type: 'documents.drawing.revision.published.v1',
        projectId,
        entityType: 'drawing_revision',
        entityId: d.id,
        entityVersion: published!.version,
        data: {
          sheetId,
          revisionId: d.id,
          sheetNumber: d.sheetNumber,
          rev: d.rev,
          previousRevisionId: prior?.currentId ?? null,
          fileId: d.fileId,
          pageIndex: d.pageIndex,
          setId,
          newSheet: !prior,
          reason: published!.publishReason,
        },
      });
    }
    await scope.tx
      .update(drawingSets)
      .set({
        status: 'published',
        publishedAt: now,
        publishedBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
        version: set.version + 1,
      })
      .where(eq(drawingSets.id, setId));
    return review(scope, projectId, setId);
  }

  /** Published markups move to the new revision as copies marked "check location" (DOC-AC8). */
  async function carryForwardMarkups(
    scope: TenantScope,
    projectId: string,
    fromRevisionId: string,
    toRevisionId: string,
  ) {
    const published = await scope.tx
      .select()
      .from(drawingMarkups)
      .where(
        and(
          eq(drawingMarkups.revisionId, fromRevisionId),
          eq(drawingMarkups.visibility, 'project'),
        ),
      );
    for (const m of published.filter((x) => !x.deletedAt)) {
      const id = uuidv7();
      await scope.tx.insert(drawingMarkups).values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        revisionId: toRevisionId,
        ownerId: m.ownerId,
        ownerCompanyId: m.ownerCompanyId,
        visibility: 'project',
        shapes: m.shapes,
        copiedFromId: m.id,
        needsLocationCheck: true,
        publishedAt: m.publishedAt,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
      await scope.recordChange({
        module: 'documents',
        entityType: 'drawing_markup',
        entityId: id,
        op: 'upsert',
        version: 1,
        projectId,
      });
    }
  }

  async function listSheets(
    scope: TenantScope,
    projectId: string,
    opts: { discipline?: string; issuedFor?: IssuedFor; limit: number; cursor?: string },
  ) {
    await c.requireProject(scope, projectId);
    const after = decodeCursor<{ n: string; id: string }>(opts.cursor);
    const conditions: SQL[] = [eq(drawingSheets.projectId, projectId)];
    if (opts.discipline) conditions.push(eq(drawingSheets.discipline, opts.discipline));
    if (after)
      conditions.push(
        or(
          gt(drawingSheets.sheetNumber, after.n),
          and(eq(drawingSheets.sheetNumber, after.n), gt(drawingSheets.id, after.id)),
        )!,
      );
    if (opts.issuedFor) conditions.push(eq(drawingRevisions.issuedFor, opts.issuedFor));
    const rows = await scope.tx
      .select({ sheet: drawingSheets, current: drawingRevisions })
      .from(drawingSheets)
      .leftJoin(drawingRevisions, eq(drawingRevisions.id, drawingSheets.currentRevisionId))
      .where(and(...conditions))
      .orderBy(asc(drawingSheets.sheetNumber), asc(drawingSheets.id))
      .limit(opts.limit + 1);
    return toPage(rows, opts.limit, (r) => ({ n: r.sheet.sheetNumber, id: r.sheet.id }));
  }

  async function sheetHistory(scope: TenantScope, projectId: string, sheetId: string) {
    const [sheet] = await scope.tx
      .select({ id: drawingSheets.id })
      .from(drawingSheets)
      .where(and(eq(drawingSheets.id, sheetId), eq(drawingSheets.projectId, projectId)))
      .limit(1);
    if (!sheet) throw new AppError('drawing_sheet.not_found');
    const rows = await scope.tx
      .select()
      .from(drawingRevisions)
      .where(eq(drawingRevisions.sheetId, sheetId))
      .orderBy(desc(drawingRevisions.publishedAt), desc(drawingRevisions.id));
    return withSuccessors(scope, rows);
  }

  async function getRevision(scope: TenantScope, projectId: string, revisionId: string) {
    const [row] = await scope.tx
      .select()
      .from(drawingRevisions)
      .where(and(eq(drawingRevisions.id, revisionId), eq(drawingRevisions.projectId, projectId)))
      .limit(1);
    if (!row) throw new AppError('drawing_revision.not_found');
    const [view] = await withSuccessors(scope, [row]);
    return view!;
  }

  /** Current revisions for whole disciplines, for "current set for discipline X" on transmittals (DOC-AC12). */
  async function currentForDisciplines(
    scope: TenantScope,
    projectId: string,
    disciplines: string[],
  ) {
    if (!disciplines.length) return [];
    return scope.tx
      .select({ revision: drawingRevisions })
      .from(drawingSheets)
      .innerJoin(drawingRevisions, eq(drawingRevisions.id, drawingSheets.currentRevisionId))
      .where(
        and(eq(drawingSheets.projectId, projectId), inArray(drawingSheets.discipline, disciplines)),
      )
      .orderBy(asc(drawingSheets.sheetNumber))
      .then((rows) => rows.map((r) => r.revision));
  }

  async function revisionsByIds(scope: TenantScope, projectId: string, ids: string[]) {
    if (!ids.length) return [];
    return scope.tx
      .select()
      .from(drawingRevisions)
      .where(and(inArray(drawingRevisions.id, ids), eq(drawingRevisions.projectId, projectId)));
  }

  async function withSuccessors(scope: TenantScope, rows: RevisionRow[]): Promise<RevisionView[]> {
    const ids = rows.map((r) => r.supersededById).filter((x): x is string => x !== null);
    const next = ids.length
      ? await scope.tx
          .select({ id: drawingRevisions.id, rev: drawingRevisions.rev })
          .from(drawingRevisions)
          .where(inArray(drawingRevisions.id, ids))
      : [];
    const byId = new Map(next.map((n) => [n.id, n]));
    return rows.map((r) => ({
      ...r,
      successor: r.supersededById ? (byId.get(r.supersededById) ?? null) : null,
    }));
  }

  return {
    listSets,
    createSet,
    review,
    addDraft,
    updateDraft,
    removeDraft,
    publish,
    listSheets,
    sheetHistory,
    getRevision,
    currentForDisciplines,
    revisionsByIds,
  };
}

function publishConflicts(open: PublishConflict[]) {
  const conflicts = open.map((x) => ({
    ...x,
    revisionId: encodeId('drawingRevision', x.revisionId),
  }));
  return new AppError(
    'drawing_set.publish_conflicts',
    'Some sheets need attention before this set can be published.',
    conflicts.map((x) => ({ path: `revisions/${x.revisionId}`, message: x.kind })),
    { conflicts },
  );
}

async function revisionChanged(
  scope: TenantScope,
  projectId: string,
  revisionId: string,
  version: number | null = null,
) {
  await scope.recordChange({
    module: 'documents',
    entityType: 'drawing_revision',
    entityId: revisionId,
    op: 'upsert',
    version,
    projectId,
  });
}

const sqlIncrement = () => sql`version + 1`;

export type DrawingService = ReturnType<typeof createDrawingService>;
