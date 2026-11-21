import { encodeId } from '@archova/domain';
import type {
  Document,
  DocumentRegisterRow,
  DocumentRevision,
  DrawingRevision,
  DrawingSet,
  DrawingSheet,
  Folder,
  Markup,
  MarkupShape,
  SheetGeometry,
  Transmittal,
  TransmittalRecipient,
} from '@archova/contracts';
import type { RegisterRow } from '../domain/distribution';
import type { DocumentWithCurrent } from '../application/documents';
import type { RevisionView } from '../application/drawings';
import type { CommentThread } from '../application/comments';
import type { ItpService } from '../application/itp';
import type { ReviewService } from '../application/reviews';
import type { SheetGeometryRow } from '../application/geometry';
import type {
  documentRevisions,
  drawingMarkups,
  drawingRevisions,
  drawingSets,
  drawingSheets,
  folders,
  itpItems,
  itpPackages,
  specBooks,
  specSections,
  transmittalRecipients,
  transmittals,
} from '../infra/tables';

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);
const userOrNull = (id: string | null) => (id ? encodeId('user', id) : null);
const companyOrNull = (id: string | null) => (id ? encodeId('company', id) : null);

export const toFolderDto = (f: typeof folders.$inferSelect): Folder => ({
  id: encodeId('folder', f.id),
  projectId: encodeId('project', f.projectId),
  parentId: f.parentId ? encodeId('folder', f.parentId) : null,
  name: f.name,
  createdAt: iso(f.createdAt),
  isPrivate: f.isPrivate,
  allowedUserIds: f.allowedUserIds.map((x) => encodeId('user', x)),
  allowedCompanyIds: f.allowedCompanyIds.map((x) => encodeId('company', x)),
  version: f.version,
});

export const toDocumentRevisionDto = (
  r: typeof documentRevisions.$inferSelect,
): DocumentRevision => ({
  id: encodeId('revision', r.id),
  documentId: encodeId('document', r.documentId),
  rev: r.rev,
  fileId: encodeId('file', r.fileId),
  status: r.status,
  issuedFor: r.issuedFor,
  issuedDate: r.issuedDate,
  notes: r.notes,
  createdAt: iso(r.createdAt),
  createdBy: userOrNull(r.createdBy),
});

export const toDocumentDto = (d: DocumentWithCurrent): Document => ({
  id: encodeId('document', d.id),
  projectId: encodeId('project', d.projectId),
  folderId: encodeId('folder', d.folderId),
  title: d.title,
  docNumber: d.docNumber,
  discipline: d.discipline,
  docType: d.docType,
  status: d.status,
  currentRevision: d.current ? toDocumentRevisionDto(d.current) : null,
  createdAt: iso(d.createdAt),
  updatedAt: iso(d.updatedAt),
  ...(d.deletedAt ? { deletedAt: iso(d.deletedAt) } : {}),
  ...(d.tracked !== undefined ? { tracked: d.tracked } : {}),
  version: d.version,
});

export const toDocumentDetail = (x: {
  document: DocumentWithCurrent;
  revisions: Array<typeof documentRevisions.$inferSelect>;
}) => ({
  document: toDocumentDto(x.document),
  revisions: x.revisions.map(toDocumentRevisionDto),
});

export const toDrawingSetDto = (s: typeof drawingSets.$inferSelect): DrawingSet => ({
  id: encodeId('drawingSet', s.id),
  projectId: encodeId('project', s.projectId),
  name: s.name,
  issuedDate: s.issuedDate,
  receivedDate: s.receivedDate,
  status: s.status,
  publishedAt: isoOrNull(s.publishedAt),
  createdAt: iso(s.createdAt),
  version: s.version,
});

export const toDrawingRevisionDto = (
  r: typeof drawingRevisions.$inferSelect & { successor?: RevisionView['successor'] },
): DrawingRevision => ({
  id: encodeId('drawingRevision', r.id),
  projectId: encodeId('project', r.projectId),
  setId: encodeId('drawingSet', r.setId),
  sheetId: r.sheetId ? encodeId('drawingSheet', r.sheetId) : null,
  sheetNumber: r.sheetNumber,
  title: r.title,
  discipline: r.discipline,
  rev: r.rev,
  issuedFor: r.issuedFor,
  fileId: encodeId('file', r.fileId),
  pageIndex: r.pageIndex,
  status: r.status,
  drawingDate: r.drawingDate,
  publishReason: r.publishReason,
  publishedAt: isoOrNull(r.publishedAt),
  supersededBy:
    r.successor && r.supersededAt
      ? {
          revisionId: encodeId('drawingRevision', r.successor.id),
          rev: r.successor.rev,
          at: iso(r.supersededAt),
        }
      : null,
  version: r.version,
});

export const toDrawingSheetDto = (x: {
  sheet: typeof drawingSheets.$inferSelect;
  current: typeof drawingRevisions.$inferSelect | null;
}): DrawingSheet => ({
  id: encodeId('drawingSheet', x.sheet.id),
  projectId: encodeId('project', x.sheet.projectId),
  sheetNumber: x.sheet.sheetNumber,
  title: x.sheet.title,
  discipline: x.sheet.discipline,
  area: x.sheet.area,
  currentRevision: x.current ? toDrawingRevisionDto(x.current) : null,
  updatedAt: iso(x.sheet.updatedAt),
  version: x.sheet.version,
});

export const toMarkupDto = (m: typeof drawingMarkups.$inferSelect): Markup => ({
  id: encodeId('markup', m.id),
  projectId: encodeId('project', m.projectId),
  revisionId: encodeId('drawingRevision', m.revisionId),
  ownerId: encodeId('user', m.ownerId),
  ownerCompanyId: companyOrNull(m.ownerCompanyId),
  visibility: m.visibility,
  shapes: m.shapes as MarkupShape[],
  copiedFromId: m.copiedFromId ? encodeId('markup', m.copiedFromId) : null,
  needsLocationCheck: m.needsLocationCheck,
  publishedAt: isoOrNull(m.publishedAt),
  createdAt: iso(m.createdAt),
  updatedAt: iso(m.updatedAt),
  version: m.version,
});

export const toTransmittalDto = (t: typeof transmittals.$inferSelect): Transmittal => ({
  id: encodeId('transmittal', t.id),
  projectId: encodeId('project', t.projectId),
  number: t.number,
  subject: t.subject,
  purpose: t.purpose,
  fromCompanyId: companyOrNull(t.fromCompanyId),
  responseDue: t.responseDue,
  message: t.message,
  status: t.status,
  sentAt: isoOrNull(t.sentAt),
  sentBy: userOrNull(t.sentBy),
  createdAt: iso(t.createdAt),
  version: t.version,
});

export const toRecipientDto = (
  r: typeof transmittalRecipients.$inferSelect,
): TransmittalRecipient => ({
  id: encodeId('transmittalRecipient', r.id),
  userId: userOrNull(r.userId),
  companyId: companyOrNull(r.companyId),
  email: r.email,
  name: r.name,
  role: r.role,
  deliveredAt: isoOrNull(r.deliveredAt),
  openedAt: isoOrNull(r.openedAt),
  downloadedAt: isoOrNull(r.downloadedAt),
  acknowledgedAt: isoOrNull(r.acknowledgedAt),
});

export const toSheetGeometryDto = (
  revisionId: string,
  g: SheetGeometryRow | null,
): SheetGeometry => ({
  revisionId: encodeId('drawingRevision', revisionId),
  status: g?.geometryKey ? 'ready' : 'pending',
  scaleDetected: g?.scaleDetected ?? null,
  scaleConfirmed: g?.scaleConfirmed ?? null,
  scaleConfirmedBy: g?.scaleConfirmedBy ? encodeId('user', g.scaleConfirmedBy) : null,
  scaleConfirmedAt: g?.scaleConfirmedAt ? g.scaleConfirmedAt.toISOString() : null,
  extractedAt: g?.extractedAt ? g.extractedAt.toISOString() : null,
  version: g?.version ?? 0,
});

export const toSpecBookDto = (b: typeof specBooks.$inferSelect, sectionCount: number) => ({
  id: encodeId('specBook', b.id),
  projectId: encodeId('project', b.projectId),
  name: b.name,
  issuedDate: b.issuedDate,
  fileId: b.fileId ? encodeId('file', b.fileId) : null,
  status: b.status,
  supersededById: b.supersededById ? encodeId('specBook', b.supersededById) : null,
  sectionCount,
  version: b.version,
});

export const toSpecSectionDto = (s: typeof specSections.$inferSelect) => ({
  id: encodeId('specSection', s.id),
  bookId: encodeId('specBook', s.bookId),
  sectionNumber: s.sectionNumber,
  title: s.title,
  division: s.division,
  pageFrom: s.pageFrom,
  pageTo: s.pageTo,
  revision: s.revision,
});

export const toRegisterRowDto = (r: RegisterRow): DocumentRegisterRow => ({
  kind: r.kind,
  id: encodeId(r.kind === 'drawing' ? 'drawingSheet' : 'document', r.key),
  number: r.number,
  title: r.title,
  discipline: r.discipline,
  currentRevisionId: r.currentRevisionId
    ? encodeId(r.kind === 'drawing' ? 'drawingRevision' : 'revision', r.currentRevisionId)
    : null,
  currentRev: r.currentRev,
  recipients: r.recipients.map((x) => ({
    email: x.email,
    name: x.name,
    companyId: companyOrNull(x.companyId),
    role: x.role,
    status: x.status,
    rev: x.rev,
    revisionId: encodeId(r.kind === 'drawing' ? 'drawingRevision' : 'revision', x.revisionId),
    transmittalId: encodeId('transmittal', x.transmittalId),
    transmittalNumber: x.transmittalNumber,
    sentAt: iso(x.sentAt),
    openedAt: isoOrNull(x.openedAt),
    downloadedAt: isoOrNull(x.downloadedAt),
    acknowledgedAt: isoOrNull(x.acknowledgedAt),
  })),
  flags: r.flags,
});

// ---- Review matrix, comments and ITP ---------------------------------------------------------------------------

/** User names are resolved by the route (one identity lookup per request); a missing user shows as null. */
export type Names = ReadonlyMap<string, string>;
const nameOf = (names: Names, id: string | null) => (id ? (names.get(id) ?? null) : null);

type ReviewView = Awaited<ReturnType<ReviewService['forDocument']>>;
type ReviewViewRound = NonNullable<ReviewView['current']>;

export const toReviewDto = (v: ReviewViewRound, names: Names) => ({
  id: encodeId('documentReview', v.review.id),
  documentId: encodeId('document', v.review.documentId),
  revisionId: encodeId('revision', v.review.revisionId),
  mode: v.review.mode,
  status: v.review.status,
  dueAt: isoOrNull(v.review.dueAt),
  note: v.review.note,
  closedAt: isoOrNull(v.review.closedAt),
  createdAt: iso(v.review.createdAt),
  stale: v.stale,
  overdueDays: v.overdueDays,
  steps: v.steps.map((s) => ({
    id: encodeId('documentReviewStep', s.id),
    userId: encodeId('user', s.userId),
    userName: nameOf(names, s.userId),
    role: s.role,
    order: s.stepOrder,
    status: s.status,
    activatedAt: isoOrNull(s.activatedAt),
    decidedAt: isoOrNull(s.decidedAt),
    decisionNote: s.decisionNote,
  })),
});

export const toReviewStateDto = (v: ReviewView, names: Names) => ({
  current: v.current ? toReviewDto(v.current, names) : null,
  history: v.history.map((h) => toReviewDto(h, names)),
  openComments: v.openComments,
});

/** Every user id a review state shows, for the one name lookup. */
export const reviewUserIds = (v: ReviewView) =>
  [v.current, ...v.history].flatMap((r) => (r ? r.steps.map((s) => s.userId) : []));

type CommentRow = CommentThread['root'];
export const toCommentDto = (c: CommentRow, names: Names) => ({
  id: encodeId('documentComment', c.id),
  documentId: encodeId('document', c.documentId),
  revisionId: c.revisionId ? encodeId('revision', c.revisionId) : null,
  parentId: c.parentId ? encodeId('documentComment', c.parentId) : null,
  body: c.body,
  page: c.page,
  status: c.status,
  authorId: userOrNull(c.createdBy),
  authorName: nameOf(names, c.createdBy),
  createdAt: iso(c.createdAt),
  resolvedById: userOrNull(c.resolvedBy),
  resolvedByName: nameOf(names, c.resolvedBy),
  resolvedAt: isoOrNull(c.resolvedAt),
  resolutionNote: c.resolutionNote,
});

export const commentUserIds = (threads: CommentThread[]) =>
  threads.flatMap((t) =>
    [t.root, ...t.replies].flatMap((c) =>
      [c.createdBy, c.resolvedBy].filter((x): x is string => !!x),
    ),
  );

export const toCommentListDto = (threads: CommentThread[], names: Names) => ({
  data: threads.map((t) => ({
    root: toCommentDto(t.root, names),
    replies: t.replies.map((r) => toCommentDto(r, names)),
  })),
});

type ItpPackageRow = typeof itpPackages.$inferSelect;
type ItpItemRow = typeof itpItems.$inferSelect;

export const toItpPackageDto = (p: ItpPackageRow) => ({
  id: encodeId('itpPackage', p.id),
  number: p.number,
  name: p.name,
  discipline: p.discipline,
  documentId: p.documentId ? encodeId('document', p.documentId) : null,
  responsibleCompanyId: companyOrNull(p.responsibleCompanyId),
  status: p.status,
  completedAt: isoOrNull(p.completedAt),
  createdAt: iso(p.createdAt),
  version: p.version,
});

export const toItpItemDto = (i: ItpItemRow, names: Names) => ({
  id: encodeId('itpItem', i.id),
  sort: i.sort,
  description: i.description,
  acceptanceCriteria: i.acceptanceCriteria,
  pointType: i.pointType,
  status: i.status,
  signedById: userOrNull(i.signedBy),
  signedByName: nameOf(names, i.signedBy),
  signedAt: isoOrNull(i.signedAt),
  note: i.note,
});

export const toItpDetailDto = (d: Awaited<ReturnType<ItpService['detail']>>, names: Names) => ({
  package: toItpPackageDto(d.package),
  items: d.items.map((i) => toItpItemDto(i, names)),
  progress: d.progress,
  document: d.document
    ? {
        id: encodeId('document', d.document.id),
        title: d.document.title,
        docNumber: d.document.docNumber,
        status: d.document.status,
      }
    : null,
});
