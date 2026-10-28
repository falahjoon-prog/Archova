import { decodeId, encodeId, type IdKind } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requireTenant,
  type Database,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { ProblemCode } from '@archova/contracts';
import type { StoredShape } from '../domain/markup';
import type { DocumentService } from '../application/documents';
import type { DrawingService } from '../application/drawings';
import type { FolderService } from '../application/folders';
import type { GeometryService } from '../application/geometry';
import type { MarkupService } from '../application/markups';
import type { TransmittalItemView, TransmittalService } from '../application/transmittals';
import {
  toDocumentDetail,
  toDocumentDto,
  toDrawingRevisionDto,
  toDrawingSetDto,
  toDrawingSheetDto,
  toFolderDto,
  toMarkupDto,
  toRecipientDto,
  toSheetGeometryDto,
  toTransmittalDto,
} from './mappers';

export interface DocumentsRouteDeps {
  database: Database;
  identity: Pick<IdentityApi, 'findUserByEmail'>;
  folders: FolderService;
  documents: DocumentService;
  drawings: DrawingService;
  markups: MarkupService;
  geometry: GeometryService;
  transmittals: TransmittalService;
}

/** Decodes a prefixed id from the path or body; a malformed id is the same 404 as a missing record. */
function id(kind: IdKind, value: string, notFound: ProblemCode): string {
  const uuid = decodeId(kind, value);
  if (!uuid) throw new AppError(notFound);
  return uuid;
}

/** Ids in request bodies that don't decode are a 422 on that field, not a 404. */
function ref(kind: IdKind, value: string, path: string): string {
  const uuid = decodeId(kind, value);
  if (!uuid)
    throw new AppError('validation_failed', 'Invalid id', [{ path, message: 'Invalid id' }]);
  return uuid;
}

const project = (p: { projectId: string }) => id('project', p.projectId, 'project.not_found');

const toTransmittalDetail = (x: Awaited<ReturnType<TransmittalService['detail']>>) => ({
  transmittal: toTransmittalDto(x.transmittal),
  items: x.items.map((i: TransmittalItemView) => ({
    ...i,
    revisionId: encodeId(
      i.revisionType === 'document' ? 'revision' : 'drawingRevision',
      i.revisionId,
    ),
  })),
  recipients: x.recipients.map(toRecipientDto),
});

export function documentsRoutes(d: DocumentsRouteDeps) {
  const ro = { readOnly: true } as const;
  const tx = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    d.database.withTenantTx(requireTenant(input), fn);
  const read = <T>(input: { tenant: TenantContext | null }, fn: (s: TenantScope) => Promise<T>) =>
    d.database.withTenantTx(requireTenant(input), fn, ro);

  return defineRoutes({
    listFolders: async (input) => {
      const rows = await read(input, (s) => d.folders.list(s, project(input.params)));
      return { status: 200, body: { data: rows.map(toFolderDto) } };
    },
    createFolder: async (input) => {
      const b = input.body;
      const row = await tx(input, (s) =>
        d.folders.create(s, project(input.params), {
          name: b.name,
          parentId: b.parentId ? ref('folder', b.parentId, 'parentId') : null,
          ...(b.isPrivate !== undefined ? { isPrivate: b.isPrivate } : {}),
          ...(b.allowedUserIds
            ? {
                allowedUserIds: b.allowedUserIds.map((u, i) =>
                  ref('user', u, `allowedUserIds/${i}`),
                ),
              }
            : {}),
          ...(b.allowedCompanyIds
            ? {
                allowedCompanyIds: b.allowedCompanyIds.map((u, i) =>
                  ref('company', u, `allowedCompanyIds/${i}`),
                ),
              }
            : {}),
        }),
      );
      return { status: 201, body: toFolderDto(row), headers: { etag: etag(row.version) } };
    },
    updateFolder: async (input) => {
      const b = input.body;
      const expected = parseIfMatch(input.headers['if-match']);
      const folderId = id('folder', input.params.folderId, 'folder.not_found');
      const row = await tx(input, (s) =>
        d.folders.update(s, project(input.params), folderId, expected, {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.isPrivate !== undefined ? { isPrivate: b.isPrivate } : {}),
          ...(b.allowedUserIds
            ? {
                allowedUserIds: b.allowedUserIds.map((u, i) =>
                  ref('user', u, `allowedUserIds/${i}`),
                ),
              }
            : {}),
          ...(b.allowedCompanyIds
            ? {
                allowedCompanyIds: b.allowedCompanyIds.map((u, i) =>
                  ref('company', u, `allowedCompanyIds/${i}`),
                ),
              }
            : {}),
        }),
      );
      return { status: 200, body: toFolderDto(row), headers: { etag: etag(row.version) } };
    },

    listDocuments: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        d.documents.list(s, project(input.params), {
          ...(q.folderId ? { folderId: id('folder', q.folderId, 'folder.not_found') } : {}),
          ...(q.q ? { q: q.q } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDocumentDto), nextCursor: page.nextCursor },
      };
    },
    createDocument: async (input) => {
      const b = input.body;
      const x = await tx(input, (s) =>
        d.documents.create(s, project(input.params), {
          ...b,
          folderId: ref('folder', b.folderId, 'folderId'),
          revision: { ...b.revision, fileId: ref('file', b.revision.fileId, 'revision.fileId') },
        }),
      );
      return {
        status: 201,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    getDocument: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const x = await read(input, (s) => d.documents.detail(s, project(input.params), documentId));
      return {
        status: 200,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    updateDocument: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const { folderId, ...rest } = input.body;
      const x = await tx(input, (s) =>
        d.documents.update(s, project(input.params), documentId, expected, {
          ...rest,
          ...(folderId ? { folderId: ref('folder', folderId, 'folderId') } : {}),
        }),
      );
      return {
        status: 200,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },
    addDocumentRevision: async (input) => {
      const documentId = id('document', input.params.documentId, 'document.not_found');
      const x = await tx(input, (s) =>
        d.documents.addRevision(s, project(input.params), documentId, {
          ...input.body,
          fileId: ref('file', input.body.fileId, 'fileId'),
        }),
      );
      return {
        status: 201,
        body: toDocumentDetail(x),
        headers: { etag: etag(x.document.version) },
      };
    },

    listDrawingSets: async (input) => {
      const page = await read(input, (s) =>
        d.drawings.listSets(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDrawingSetDto), nextCursor: page.nextCursor },
      };
    },
    createDrawingSet: async (input) => {
      const row = await tx(input, (s) =>
        d.drawings.createSet(s, project(input.params), input.body),
      );
      return { status: 201, body: toDrawingSetDto(row) };
    },
    getDrawingSetReview: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const x = await read(input, (s) => d.drawings.review(s, project(input.params), setId));
      return { status: 200, body: toReview(x) };
    },
    addDrawingSetRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const row = await tx(input, (s) =>
        d.drawings.addDraft(s, project(input.params), setId, {
          ...input.body,
          fileId: ref('file', input.body.fileId, 'fileId'),
          ...(input.body.aiSuggestionId
            ? { aiSuggestionId: ref('aiSuggestion', input.body.aiSuggestionId, 'aiSuggestionId') }
            : {}),
        }),
      );
      return { status: 201, body: toDrawingRevisionDto(row), headers: { etag: etag(row.version) } };
    },
    updateDraftDrawingRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await tx(input, (s) =>
        d.drawings.updateDraft(s, project(input.params), setId, revisionId, expected, input.body),
      );
      return { status: 200, body: toDrawingRevisionDto(row), headers: { etag: etag(row.version) } };
    },
    removeDraftDrawingRevision: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      await tx(input, (s) => d.drawings.removeDraft(s, project(input.params), setId, revisionId));
      return { status: 204 };
    },
    publishDrawingSet: async (input) => {
      const setId = id('drawingSet', input.params.drawingSetId, 'drawing_set.not_found');
      const reasons = new Map(
        (input.body.reasons ?? []).map((r, i) => [
          ref('drawingRevision', r.revisionId, `reasons/${i}/revisionId`),
          r.reason,
        ]),
      );
      const x = await tx(input, (s) =>
        d.drawings.publish(s, project(input.params), setId, {
          confirmNewSheets: input.body.confirmNewSheets ?? false,
          reasons,
        }),
      );
      return { status: 200, body: toReview(x) };
    },
    listDrawings: async (input) => {
      const q = input.query;
      const page = await read(input, (s) =>
        d.drawings.listSheets(s, project(input.params), {
          ...(q.discipline ? { discipline: q.discipline } : {}),
          ...(q.issuedFor ? { issuedFor: q.issuedFor } : {}),
          limit: q.limit,
          ...(q.cursor ? { cursor: q.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toDrawingSheetDto), nextCursor: page.nextCursor },
      };
    },
    listDrawingSheetRevisions: async (input) => {
      const sheetId = id('drawingSheet', input.params.drawingSheetId, 'drawing_sheet.not_found');
      const rows = await read(input, (s) =>
        d.drawings.sheetHistory(s, project(input.params), sheetId),
      );
      return { status: 200, body: { data: rows.map(toDrawingRevisionDto) } };
    },
    getDrawingRevision: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const row = await read(input, (s) =>
        d.drawings.getRevision(s, project(input.params), revisionId),
      );
      return { status: 200, body: toDrawingRevisionDto(row) };
    },

    getSheetGeometry: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const g = await read(input, (s) => d.geometry.get(s, project(input.params), revisionId));
      return {
        status: 200,
        body: toSheetGeometryDto(revisionId, g.row),
        headers: { etag: etag(g.row?.version ?? 0) },
      };
    },
    confirmSheetScale: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const header = input.headers['if-match'];
      const expected = header ? parseIfMatch(header) : null;
      const row = await tx(input, (s) =>
        d.geometry.confirmScale(s, project(input.params), revisionId, input.body.scale, expected),
      );
      return {
        status: 200,
        body: toSheetGeometryDto(revisionId, row),
        headers: { etag: etag(row.version) },
      };
    },
    listMarkups: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const rows = await read(input, (s) => d.markups.list(s, project(input.params), revisionId));
      return { status: 200, body: { data: rows.map(toMarkupDto) } };
    },
    createMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const row = await tx(input, (s) =>
        d.markups.create(s, project(input.params), revisionId, {
          shapes: input.body.shapes as StoredShape[],
          ...(input.body.visibility ? { visibility: input.body.visibility } : {}),
        }),
      );
      return { status: 201, body: toMarkupDto(row), headers: { etag: etag(row.version) } };
    },
    updateMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const markupId = id('markup', input.params.markupId, 'markup.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const b = input.body;
      const row = await tx(input, (s) =>
        d.markups.update(s, project(input.params), revisionId, markupId, expected, {
          ...(b.visibility ? { visibility: b.visibility } : {}),
          ...(b.shapes ? { shapes: b.shapes as StoredShape[] } : {}),
          ...(b.locationConfirmed ? { locationConfirmed: true } : {}),
        }),
      );
      return { status: 200, body: toMarkupDto(row), headers: { etag: etag(row.version) } };
    },
    deleteMarkup: async (input) => {
      const revisionId = id(
        'drawingRevision',
        input.params.drawingRevisionId,
        'drawing_revision.not_found',
      );
      const markupId = id('markup', input.params.markupId, 'markup.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      await tx(input, (s) =>
        d.markups.remove(s, project(input.params), revisionId, markupId, expected),
      );
      return { status: 204 };
    },

    listTransmittals: async (input) => {
      const page = await read(input, (s) =>
        d.transmittals.list(s, project(input.params), {
          limit: input.query.limit,
          ...(input.query.cursor ? { cursor: input.query.cursor } : {}),
        }),
      );
      return {
        status: 200,
        body: { data: page.data.map(toTransmittalDto), nextCursor: page.nextCursor },
      };
    },
    createTransmittal: async (input) => {
      const b = input.body;
      // Identity lookups run before the tenant transaction (identity is the global layer).
      const recipients = await Promise.all(
        b.recipients.map(async (r, i) => ({
          email: r.email,
          ...(r.name ? { name: r.name } : {}),
          ...(r.role ? { role: r.role } : {}),
          ...(r.companyId
            ? { companyId: ref('company', r.companyId, `recipients/${i}/companyId`) }
            : {}),
          userId: (await d.identity.findUserByEmail(r.email))?.id ?? null,
        })),
      );
      const x = await tx(input, (s) =>
        d.transmittals.create(s, project(input.params), {
          subject: b.subject,
          purpose: b.purpose,
          ...(b.fromCompanyId
            ? { fromCompanyId: ref('company', b.fromCompanyId, 'fromCompanyId') }
            : {}),
          ...(b.responseDue ? { responseDue: b.responseDue } : {}),
          ...(b.message ? { message: b.message } : {}),
          recipients,
          items: (b.items ?? []).map((it, i) => ({
            revisionType: it.revisionType,
            revisionId: ref(
              it.revisionType === 'document' ? 'revision' : 'drawingRevision',
              it.revisionId,
              `items/${i}/revisionId`,
            ),
          })),
          currentSetDisciplines: b.currentSetDisciplines ?? [],
        }),
      );
      return {
        status: 201,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    getTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const x = await read(input, (s) =>
        d.transmittals.detail(s, project(input.params), transmittalId),
      );
      return {
        status: 200,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    sendTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const expected = parseIfMatch(input.headers['if-match']);
      const x = await tx(input, (s) =>
        d.transmittals.send(s, project(input.params), transmittalId, expected),
      );
      return {
        status: 200,
        body: toTransmittalDetail(x),
        headers: { etag: etag(x.transmittal.version) },
      };
    },
    acknowledgeTransmittal: async (input) => {
      const transmittalId = id('transmittal', input.params.transmittalId, 'transmittal.not_found');
      const row = await tx(input, (s) =>
        d.transmittals.acknowledge(s, project(input.params), transmittalId, input.body.event),
      );
      return { status: 200, body: toRecipientDto(row) };
    },
  });
}

function toReview(x: Awaited<ReturnType<DrawingService['review']>>) {
  return {
    set: toDrawingSetDto(x.set),
    revisions: x.revisions.map(toDrawingRevisionDto),
    conflicts: x.conflicts.map((c) => ({
      ...c,
      revisionId: encodeId('drawingRevision', c.revisionId),
    })),
  };
}
