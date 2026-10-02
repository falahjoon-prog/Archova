// Folders, documents and their revisions as the documents screen uses them. The API source maps the contract's
// `Folder`, `Document` and `DocumentRevision` onto these; the preview store holds them directly.

export interface Folder {
  id: string;
  parentId: string | null;
  name: string;
  isPrivate: boolean;
}

export type DocumentStatus =
  'draft' | 'for_review' | 'approved' | 'for_construction' | 'superseded' | 'void';

export interface ProjectDocument {
  id: string;
  folderId: string;
  title: string;
  docNumber: string | null;
  docType: string | null;
  status: DocumentStatus;
  currentRev: string;
  currentRevisionId: string;
  updatedAt: string;
  /** Who added the current revision, when known by name. */
  updatedBy: string | null;
}

export interface DocumentRevision {
  id: string;
  documentId: string;
  rev: string;
  /** The stored file to download; null in the preview. */
  fileId: string | null;
  fileName: string;
  status: 'current' | 'superseded';
  issuedFor: string | null;
  issuedDate: string | null;
  notes: string | null;
  createdBy: string | null;
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  for_review: 'For review',
  approved: 'Approved',
  for_construction: 'For construction',
  superseded: 'Superseded',
  void: 'Void',
};

export interface NewRevisionInput {
  rev: string;
  file: File;
  notes: string;
}
