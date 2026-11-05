import { and, asc, desc, eq, gt, inArray, isNull, notInArray, sql, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, versionConflict, type TenantScope } from '@archova/kernel';
import { documentRevisions, documentsTable, type DocumentStatus } from '../infra/tables';
import type { DocumentsContext } from './context';
import { uniqueViolation } from './errors';
import type { FolderService } from './folders';

type DocumentRow = typeof documentsTable.$inferSelect;
type RevisionRow = typeof documentRevisions.$inferSelect;

export interface RevisionInput {
  rev: string;
  fileId: string;
  issuedFor?: string;
  issuedDate?: string;
  notes?: string;
}

export interface CreateDocumentInput {
  folderId: string;
  title: string;
  docNumber?: string;
  discipline?: string;
  docType?: string;
  status?: DocumentStatus;
  revision: RevisionInput;
}

export interface UpdateDocumentInput {
  folderId?: string;
  title?: string;
  docNumber?: string | null;
  discipline?: string | null;
  docType?: string | null;
  status?: DocumentStatus;
}

export type DocumentWithCurrent = DocumentRow & { current: RevisionRow | null };

export function createDocumentService(c: DocumentsContext, folders: FolderService) {
  async function attachCurrent(scope: TenantScope, rows: DocumentRow[]) {
    const ids = rows.map((r) => r.currentRevisionId).filter((x): x is string => x !== null);
    const revs = ids.length
      ? await scope.tx.select().from(documentRevisions).where(inArray(documentRevisions.id, ids))
      : [];
    const byId = new Map(revs.map((r) => [r.id, r]));
    return rows.map((r) => ({
      ...r,
      current: r.currentRevisionId ? (byId.get(r.currentRevisionId) ?? null) : null,
    }));
  }

  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { folderId?: string; q?: string; limit: number; cursor?: string },
  ): Promise<{ data: DocumentWithCurrent[]; nextCursor: string | null }> {
    await c.requireProject(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(documentsTable.projectId, projectId),
      isNull(documentsTable.deletedAt),
    ];
    if (opts.folderId) {
      await folders.getVisible(scope, projectId, opts.folderId);
      conditions.push(eq(documentsTable.folderId, opts.folderId));
    } else {
      const hidden = await folders.hiddenIds(scope, projectId);
      if (hidden.size) conditions.push(notInArray(documentsTable.folderId, [...hidden]));
    }
    if (opts.q)
      conditions.push(
        sql`documents.documents.search @@ websearch_to_tsquery('english', ${opts.q})`,
      );
    if (after) conditions.push(gt(documentsTable.id, after.id));
    const rows = await scope.tx
      .select()
      .from(documentsTable)
      .where(and(...conditions))
      .orderBy(asc(documentsTable.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    return { data: await attachCurrent(scope, page.data), nextCursor: page.nextCursor };
  }

  async function getRow(scope: TenantScope, projectId: string, documentId: string) {
    const [row] = await scope.tx
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.id, documentId),
          eq(documentsTable.projectId, projectId),
          isNull(documentsTable.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw new AppError('document.not_found');
    // Documents in folders the caller can't open don't exist for them.
    const hidden = await folders.hiddenIds(scope, projectId);
    if (hidden.has(row.folderId)) throw new AppError('document.not_found');
    return row;
  }

  async function detail(scope: TenantScope, projectId: string, documentId: string) {
    const row = await getRow(scope, projectId, documentId);
    const revisions = await scope.tx
      .select()
      .from(documentRevisions)
      .where(eq(documentRevisions.documentId, documentId))
      .orderBy(desc(documentRevisions.createdAt), desc(documentRevisions.id));
    const [withCurrent] = await attachCurrent(scope, [row]);
    return { document: withCurrent!, revisions };
  }

  /** Inserts a revision as current and supersedes the previous current one (backend 04 documents). */
  async function insertRevision(
    scope: TenantScope,
    doc: { id: string; projectId: string },
    input: RevisionInput,
  ): Promise<RevisionRow> {
    await c.requireReadyFile(scope, doc.projectId, input.fileId);
    const [dupe] = await scope.tx
      .select({ id: documentRevisions.id })
      .from(documentRevisions)
      .where(
        and(
          eq(documentRevisions.documentId, doc.id),
          sql`upper(${documentRevisions.rev}) = upper(${input.rev.trim()})`,
        ),
      )
      .limit(1);
    if (dupe)
      throw new AppError(
        'document.revision_exists',
        `Revision ${input.rev} is already registered.`,
      );
    const now = new Date();
    await scope.tx
      .update(documentRevisions)
      .set({ status: 'superseded', supersededAt: now, updatedBy: scope.ctx.userId })
      .where(
        and(eq(documentRevisions.documentId, doc.id), eq(documentRevisions.status, 'current')),
      );
    const [rev] = await scope.tx
      .insert(documentRevisions)
      .values({
        id: uuidv7(),
        orgId: scope.ctx.orgId,
        projectId: doc.projectId,
        documentId: doc.id,
        rev: input.rev.trim(),
        fileId: input.fileId,
        status: 'current',
        issuedFor: input.issuedFor ?? null,
        issuedDate: input.issuedDate ?? null,
        notes: input.notes ?? null,
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    return rev!;
  }

  async function create(scope: TenantScope, projectId: string, input: CreateDocumentInput) {
    await c.requireProject(scope, projectId);
    await folders.getVisible(scope, projectId, input.folderId);
    const id = uuidv7();
    try {
      await scope.tx.insert(documentsTable).values({
        id,
        orgId: scope.ctx.orgId,
        projectId,
        folderId: input.folderId,
        title: input.title.trim(),
        docNumber: input.docNumber?.trim() ?? null,
        discipline: input.discipline ?? null,
        docType: input.docType ?? null,
        status: input.status ?? 'draft',
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      });
    } catch (e) {
      if (uniqueViolation(e) === 'documents_number') throw numberTaken();
      throw e;
    }
    const rev = await insertRevision(scope, { id, projectId }, input.revision);
    await scope.tx
      .update(documentsTable)
      .set({ currentRevisionId: rev.id })
      .where(eq(documentsTable.id, id));
    await changed(scope, projectId, id, 1);
    scope.events.add({
      type: 'documents.document.created.v1',
      projectId,
      entityType: 'document',
      entityId: id,
      entityVersion: 1,
      data: { documentId: id, revisionId: rev.id, rev: rev.rev, fileId: rev.fileId },
    });
    return detail(scope, projectId, id);
  }

  async function addRevision(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    input: RevisionInput,
  ) {
    const row = await getRow(scope, projectId, documentId);
    const rev = await insertRevision(scope, row, input);
    const [updated] = await scope.tx
      .update(documentsTable)
      .set({ currentRevisionId: rev.id, version: row.version + 1, updatedBy: scope.ctx.userId })
      .where(eq(documentsTable.id, documentId))
      .returning();
    await changed(scope, projectId, documentId, updated!.version);
    scope.events.add({
      type: 'documents.document.revision.added.v1',
      projectId,
      entityType: 'document',
      entityId: documentId,
      entityVersion: updated!.version,
      data: {
        documentId,
        revisionId: rev.id,
        rev: rev.rev,
        previousRevisionId: row.currentRevisionId,
        fileId: rev.fileId,
      },
    });
    return detail(scope, projectId, documentId);
  }

  async function update(
    scope: TenantScope,
    projectId: string,
    documentId: string,
    expectedVersion: number,
    patch: UpdateDocumentInput,
  ) {
    const current = await getRow(scope, projectId, documentId);
    if (current.version !== expectedVersion) throw versionConflict();
    if (patch.folderId !== undefined) await folders.getVisible(scope, projectId, patch.folderId);
    const values: Partial<typeof documentsTable.$inferInsert> = {
      updatedBy: scope.ctx.userId,
      version: current.version + 1,
    };
    if (patch.folderId !== undefined) values.folderId = patch.folderId;
    if (patch.title !== undefined) values.title = patch.title.trim();
    if (patch.docNumber !== undefined) values.docNumber = patch.docNumber?.trim() ?? null;
    if (patch.discipline !== undefined) values.discipline = patch.discipline;
    if (patch.docType !== undefined) values.docType = patch.docType;
    if (patch.status !== undefined) values.status = patch.status;
    let rows: DocumentRow[];
    try {
      rows = await scope.tx
        .update(documentsTable)
        .set(values)
        .where(and(eq(documentsTable.id, documentId), eq(documentsTable.version, expectedVersion)))
        .returning();
    } catch (e) {
      if (uniqueViolation(e) === 'documents_number') throw numberTaken();
      throw e;
    }
    if (!rows[0]) throw versionConflict();
    await changed(scope, projectId, documentId, rows[0].version);
    scope.events.add({
      type: 'documents.document.updated.v1',
      projectId,
      entityType: 'document',
      entityId: documentId,
      entityVersion: rows[0].version,
      data: { documentId, changed: Object.keys(patch) },
    });
    return detail(scope, projectId, documentId);
  }

  /** Revisions by id, for transmittals. Only revisions in this project and in folders the caller can open. */
  /** `authorised`: the caller has already decided the reader may see these (a transmittal's issuer chose them). */
  async function revisionsByIds(
    scope: TenantScope,
    projectId: string,
    ids: string[],
    opts: { authorised?: boolean } = {},
  ) {
    if (!ids.length) return [];
    const hidden = opts.authorised ? new Set<string>() : await folders.hiddenIds(scope, projectId);
    const rows = await scope.tx
      .select({ revision: documentRevisions, document: documentsTable })
      .from(documentRevisions)
      .innerJoin(documentsTable, eq(documentsTable.id, documentRevisions.documentId))
      .where(and(inArray(documentRevisions.id, ids), eq(documentRevisions.projectId, projectId)));
    return rows.filter((r) => !hidden.has(r.document.folderId) && !r.document.deletedAt);
  }

  /** A document's title for another module's record (an induction's SWMS), with the same visibility check. */
  async function ref(scope: TenantScope, projectId: string, documentId: string) {
    const row = await getRow(scope, projectId, documentId);
    return { id: row.id, title: row.title, docNumber: row.docNumber };
  }

  /**
   * The current revision's file of a live document in this project, with no folder check: the caller is another
   * module that has already authorised the read (an induction's SWMS for a worker who holds only sign-in).
   */
  async function currentFileAuthorised(scope: TenantScope, projectId: string, documentId: string) {
    const [row] = await scope.tx
      .select()
      .from(documentsTable)
      .where(
        and(
          eq(documentsTable.id, documentId),
          eq(documentsTable.projectId, projectId),
          isNull(documentsTable.deletedAt),
        ),
      )
      .limit(1);
    const [withCurrent] = row ? await attachCurrent(scope, [row]) : [];
    if (!withCurrent?.current) throw new AppError('document.not_found');
    const { current } = withCurrent;
    return {
      id: withCurrent.id,
      title: withCurrent.title,
      docNumber: withCurrent.docNumber,
      rev: current.rev,
      fileId: current.fileId,
    };
  }

  /**
   * Mobile pull (modules/sync): the documents among `ids` the caller may see, by the same rule as `list`
   * (nothing in a folder they can't open); ids not returned are sent to the device as deletes.
   */
  async function visibleAmong(scope: TenantScope, projectId: string, ids: readonly string[]) {
    if (!ids.length) return [];
    const conditions: SQL[] = [
      eq(documentsTable.projectId, projectId),
      isNull(documentsTable.deletedAt),
      inArray(documentsTable.id, [...ids]),
    ];
    const hidden = await folders.hiddenIds(scope, projectId);
    if (hidden.size) conditions.push(notInArray(documentsTable.folderId, [...hidden]));
    const rows = await scope.tx
      .select()
      .from(documentsTable)
      .where(and(...conditions));
    return attachCurrent(scope, rows);
  }

  return {
    list,
    detail,
    create,
    addRevision,
    update,
    revisionsByIds,
    ref,
    currentFileAuthorised,
    visibleAmong,
  };
}

async function changed(scope: TenantScope, projectId: string, id: string, version: number) {
  await scope.recordChange({
    module: 'documents',
    entityType: 'document',
    entityId: id,
    op: 'upsert',
    version,
    projectId,
  });
}

const numberTaken = () =>
  new AppError('document.number_taken', 'Another document already uses that number.');

export type DocumentService = ReturnType<typeof createDocumentService>;
