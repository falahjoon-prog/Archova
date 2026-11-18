// Documents data source, mirroring `CRUD {p}/folders`, `CRUD {p}/documents` and
// `POST {p}/documents/{id}/revisions` (backend 04 §3). Preview: in-memory store with the AU project template folders.
// `api.ts` is the same interface against the API; `useDocumentsSource` picks one (shared/lib/data-mode).

import { delay, mockId, nowIso, problem, projectStores } from '@/shared/mocks/runtime';
import {
  NEW_DOCUMENTS_DAYS,
  type DocumentRevision,
  type DocumentsView,
  type Folder,
  type NewRevisionInput,
  type ProjectDocument,
} from '../lib/types';

interface Store {
  folders: Folder[];
  documents: ProjectDocument[];
  revisions: DocumentRevision[];
}

function seed(): Store {
  const folders: Folder[] = [
    { id: 'fld_contract', parentId: null, name: 'Contract', isPrivate: true },
    { id: 'fld_reports', parentId: null, name: 'Reports and investigations', isPrivate: false },
    // AU template: a standard folder for BCA/NCC and certifier documents (product 02).
    { id: 'fld_cert', parentId: null, name: 'Certification (BCA/NCC)', isPrivate: false },
    { id: 'fld_specs', parentId: null, name: 'Specifications', isPrivate: false },
  ];
  const doc = (
    id: string,
    folderId: string,
    title: string,
    docNumber: string | null,
    docType: string,
    status: ProjectDocument['status'],
    revs: Array<[string, string, string]>,
  ): void => {
    revs.forEach(([rev, date, fileName], i) => {
      revisions.push({
        id: `${id}_r${i}`,
        documentId: id,
        rev,
        fileId: null,
        fileName,
        status: i === revs.length - 1 ? 'current' : 'superseded',
        issuedFor: null,
        issuedDate: date,
        notes: null,
        createdBy: 'Dana Okafor',
      });
    });
    const last = revs[revs.length - 1]!;
    documents.push({
      id,
      folderId,
      title,
      docNumber,
      docType,
      status,
      currentRev: last[0],
      currentRevisionId: `${id}_r${revs.length - 1}`,
      createdAt: `${revs[0]![1]}T02:00:00Z`,
      updatedAt: `${last[1]}T02:00:00Z`,
      updatedBy: 'Dana Okafor',
      tracked: false,
      deletedAt: null,
      version: 1,
    });
  };
  const documents: ProjectDocument[] = [];
  const revisions: DocumentRevision[] = [];
  doc('doc_geo', 'fld_reports', 'Geotechnical investigation', 'RPT-001', 'Report', 'approved', [
    ['A', '2026-05-02', 'geotech-report-revA.pdf'],
  ]);
  doc('doc_acoustic', 'fld_reports', 'Acoustic report', 'RPT-002', 'Report', 'for_review', [
    ['A', '2026-07-11', 'acoustic-A.pdf'],
    ['B', '2026-09-01', 'acoustic-B.pdf'],
  ]);
  doc('doc_cc', 'fld_cert', 'Construction certificate', 'CC-0141', 'Certificate', 'approved', [
    ['1', '2026-06-20', 'construction-certificate.pdf'],
  ]);
  doc(
    'doc_spec',
    'fld_specs',
    'Project specification (NATSPEC)',
    'SPEC-01',
    'Specification',
    'for_construction',
    [
      ['1', '2026-06-01', 'specification-v1.pdf'],
      ['2', '2026-08-15', 'specification-v2.pdf'],
    ],
  );
  doc('doc_hc', 'fld_contract', 'Head contract AS 4000', 'CON-001', 'Contract', 'approved', [
    ['1', '2026-04-14', 'head-contract-executed.pdf'],
  ]);
  return { folders, documents, revisions };
}

const stores = projectStores<Store>(seed);

export type DocumentsSource = typeof documentsSource;

export const documentsSource = {
  async listFolders(projectId: string): Promise<Folder[]> {
    return delay(stores.get(projectId).folders);
  },
  async listDocuments(
    projectId: string,
    folderId: string | null,
    view: DocumentsView = 'all',
  ): Promise<ProjectDocument[]> {
    const since = new Date(Date.now() - NEW_DOCUMENTS_DAYS * 86_400_000).toISOString();
    const docs = stores
      .get(projectId)
      .documents.filter(
        (d) =>
          !d.deletedAt &&
          (!folderId || d.folderId === folderId) &&
          (view !== 'week' || d.createdAt >= since) &&
          (view !== 'tracked' || d.tracked),
      );
    return delay(docs.sort((a, b) => a.title.localeCompare(b.title)));
  },
  /** The recycle bin, most recently deleted first. */
  async listBin(projectId: string): Promise<ProjectDocument[]> {
    const docs = stores.get(projectId).documents.filter((d) => d.deletedAt);
    return delay(docs.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? '')));
  },
  async setTracked(projectId: string, documentId: string, tracked: boolean): Promise<void> {
    const doc = stores.get(projectId).documents.find((d) => d.id === documentId && !d.deletedAt);
    if (!doc) problem(404, 'not_found', "We couldn't find that document.");
    doc.tracked = tracked;
    return delay(undefined);
  },
  async deleteDocument(projectId: string, target: { id: string; version: number }): Promise<void> {
    const doc = stores.get(projectId).documents.find((d) => d.id === target.id && !d.deletedAt);
    if (!doc) problem(404, 'not_found', "We couldn't find that document.");
    doc.deletedAt = nowIso();
    doc.version += 1;
    return delay(undefined);
  },
  async restoreDocument(projectId: string, documentId: string): Promise<ProjectDocument> {
    const doc = stores.get(projectId).documents.find((d) => d.id === documentId && d.deletedAt);
    if (!doc) problem(404, 'not_found', "We couldn't find that document.");
    doc.deletedAt = null;
    doc.version += 1;
    return delay(doc);
  },
  async listRevisions(projectId: string, documentId: string): Promise<DocumentRevision[]> {
    return delay(
      stores
        .get(projectId)
        .revisions.filter((r) => r.documentId === documentId)
        .reverse(),
    );
  },
  /** New revision: the previous one becomes superseded in the same step. */
  async addRevision(
    projectId: string,
    documentId: string,
    input: NewRevisionInput,
    actor: { name: string },
  ): Promise<ProjectDocument> {
    const s = stores.get(projectId);
    const doc = s.documents.find((d) => d.id === documentId);
    if (!doc) problem(404, 'not_found', "We couldn't find that document.");
    if (s.revisions.some((r) => r.documentId === documentId && r.rev === input.rev)) {
      problem(
        409,
        'document.revision_exists',
        `Rev ${input.rev} already exists for this document.`,
      );
    }
    for (const r of s.revisions) if (r.documentId === documentId) r.status = 'superseded';
    const rev: DocumentRevision = {
      id: mockId('drv'),
      documentId,
      rev: input.rev,
      fileId: null,
      fileName: input.file.name,
      status: 'current',
      issuedFor: null,
      issuedDate: nowIso().slice(0, 10),
      notes: input.notes || null,
      createdBy: actor.name,
    };
    s.revisions.push(rev);
    Object.assign(doc, {
      currentRev: rev.rev,
      currentRevisionId: rev.id,
      updatedAt: nowIso(),
      updatedBy: actor.name,
    });
    return delay(doc);
  },
};

export function resetDocumentsPreview() {
  stores.reset();
}
