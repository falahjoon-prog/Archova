// Documents against the documents module's endpoints (backend 04 §3), with the same interface as the preview
// source in `source.ts`. Each call maps the contract's records onto the screen's types in `lib/types.ts`.

import { unwrap } from '@archova/api-client';
import type {
  Document as ApiDocument,
  DocumentRevision as ApiRevision,
  Folder as ApiFolder,
} from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { projectPeople } from '@/shared/lib/people';
import { uploadFile } from '@/shared/lib/uploads';
import type { DocumentRevision, Folder, NewRevisionInput, ProjectDocument } from '../lib/types';
import type { DocumentsSource } from './source';

export function toFolder(f: ApiFolder): Folder {
  return { id: f.id, parentId: f.parentId, name: f.name, isPrivate: f.isPrivate };
}

export function toDocument(d: ApiDocument): ProjectDocument {
  return {
    id: d.id,
    folderId: d.folderId,
    title: d.title,
    docNumber: d.docNumber,
    docType: d.docType,
    status: d.status,
    currentRev: d.currentRevision?.rev ?? '—',
    currentRevisionId: d.currentRevision?.id ?? '',
    updatedAt: d.updatedAt,
    // The API gives user ids, not names; the screen leaves the name out rather than show an id.
    updatedBy: null,
  };
}

export function toRevision(
  r: ApiRevision,
  fileName: string,
  people: Map<string, string> = new Map(),
): DocumentRevision {
  return {
    id: r.id,
    documentId: r.documentId,
    rev: r.rev,
    fileId: r.fileId,
    fileName,
    status: r.status,
    issuedFor: r.issuedFor,
    issuedDate: r.issuedDate ?? r.createdAt.slice(0, 10),
    notes: r.notes,
    createdBy: r.createdBy ? (people.get(r.createdBy) ?? null) : null,
  };
}

export function createDocumentsApi(orgId: string): DocumentsSource {
  const fileName = async (fileId: string) => {
    const res = await api.GET('/v1/orgs/{orgId}/files/{fileId}', {
      params: { path: { orgId, fileId } },
    });
    // A file the caller can't read still has a revision worth listing.
    return res.data?.filename ?? 'File';
  };

  return {
    async listFolders(projectId) {
      const res = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/folders', {
          params: { path: { orgId, projectId } },
        }),
      );
      return res.data.map(toFolder);
    },

    async listDocuments(projectId, folderId) {
      const docs = await allPages(async (cursor) =>
        unwrap(
          await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents', {
            params: {
              path: { orgId, projectId },
              query: {
                limit: 200,
                ...(folderId ? { folderId } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      );
      return docs.map(toDocument).sort((a, b) => a.title.localeCompare(b.title));
    },

    async listRevisions(projectId, documentId) {
      const detail = unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/documents/{documentId}', {
          params: { path: { orgId, projectId, documentId } },
        }),
      );
      const [names, people] = await Promise.all([
        Promise.all(detail.revisions.map((r) => fileName(r.fileId))),
        projectPeople(orgId, projectId),
      ]);
      return detail.revisions.map((r, i) => toRevision(r, names[i]!, people));
    },

    async addRevision(projectId, documentId, input: NewRevisionInput) {
      const file = await uploadFile(orgId, { file: input.file, projectId, module: 'documents' });
      await ensureCsrfToken();
      const detail = unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/documents/{documentId}/revisions', {
          params: { path: { orgId, projectId, documentId } },
          body: { rev: input.rev, fileId: file.id, ...(input.notes ? { notes: input.notes } : {}) },
        }),
      );
      return toDocument(detail.document);
    },
  };
}
