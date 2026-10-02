// `documents.folders`, `documents.documents` and `documents.document_revisions` (backend schema), camelCase.

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
  docType: string;
  status: DocumentStatus;
  currentRev: string;
  currentRevisionId: string;
  updatedAt: string;
  updatedBy: string;
}

export interface DocumentRevision {
  id: string;
  documentId: string;
  rev: string;
  fileName: string;
  status: 'current' | 'superseded';
  issuedFor: string | null;
  issuedDate: string;
  notes: string | null;
  createdBy: string;
}

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Draft',
  for_review: 'For review',
  approved: 'Approved',
  for_construction: 'For construction',
  superseded: 'Superseded',
  void: 'Void',
};
