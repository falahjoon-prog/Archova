import { decodeId, encodeId, isUuid, type IdKind } from '@archova/domain';
import type { FileObject } from '@archova/contracts';
import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { FilesService } from '../application/files-service';
import type { PhotoAlbumsService } from '../application/photo-albums';
import type { fileObjects, PhotoCategory, PhotoFilingSource, PhotoRefKind } from '../infra/tables';
import { rowToCapture } from '../domain/capture';

const toFileDto = (f: typeof fileObjects.$inferSelect): FileObject => ({
  id: encodeId('file', f.id),
  projectId: f.projectId ? encodeId('project', f.projectId) : null,
  module: f.module,
  filename: f.filename,
  mime: f.mime,
  sizeBytes: f.sizeBytes,
  sha256: f.sha256,
  status: f.status,
  capture: rowToCapture(f),
  createdAt: f.createdAt.toISOString(),
});

const fileUuid = (id: string) => {
  const uuid = decodeId('file', id);
  if (!uuid) throw new AppError('file.not_found');
  return uuid;
};

const albumUuid = (id: string) => {
  const uuid = decodeId('photoAlbum', id);
  if (!uuid) throw new AppError('photo_album.not_found');
  return uuid;
};

const encodeCursor = (c: { at: Date; id: string }) =>
  Buffer.from(`${c.at.toISOString()}|${c.id}`).toString('base64url');

function decodeCursor(raw: string | undefined) {
  if (!raw) return undefined;
  const [at, id] = Buffer.from(raw, 'base64url').toString().split('|');
  const date = at ? new Date(at) : null;
  if (!date || Number.isNaN(date.getTime()) || !id || !isUuid(id))
    throw new AppError('validation_failed', 'That page link is not valid.', [
      { path: 'cursor', message: 'Invalid cursor' },
    ]);
  return { at: date, id };
}

const projectOf = (id: string) => {
  const projectId = decodeId('project', id);
  if (!projectId) throw new AppError('project.not_found');
  return projectId;
};

const toFilingDto = (f: {
  fileId: string;
  category: PhotoCategory;
  refKind: PhotoRefKind | null;
  refId: string | null;
  source: PhotoFilingSource;
}) => ({
  fileId: encodeId('file', f.fileId),
  category: f.category,
  refKind: f.refKind,
  refId: f.refId ? encodeId(REF_ID_KIND[f.refKind ?? 'rfi'], f.refId) : null,
  source: f.source,
});

const REF_ID_KIND = {
  rfi: 'rfi',
  defect: 'defect',
  observation: 'observation',
  inspection: 'inspection',
  diary_entry: 'diary',
  drawing_revision: 'revision',
} as const satisfies Record<PhotoRefKind, IdKind>;

export function filesRoutes(database: Database, files: FilesService, albums: PhotoAlbumsService) {
  return defineRoutes({
    createUpload: async (input) => {
      const projectId = input.body.projectId ? decodeId('project', input.body.projectId) : null;
      if (input.body.projectId && !projectId) throw new AppError('project.not_found');
      const upload = await database.withTenantTx(requireTenant(input), (s) =>
        files.createUpload(s, { ...input.body, projectId }),
      );
      return {
        status: 201,
        body: {
          id: encodeId('upload', upload.id),
          status: upload.status,
          uploadUrl: upload.uploadUrl,
          uploadMethod: 'PUT',
          uploadHeaders: upload.uploadHeaders,
          expiresAt: upload.expiresAt.toISOString(),
        },
      };
    },
    completeUpload: async (input) => {
      const uploadId = decodeId('upload', input.params.uploadId);
      if (!uploadId) throw new AppError('upload.not_found');
      const row = await database.withTenantTx(
        requireTenant(input),
        (s) => files.complete(s, uploadId),
        { statementTimeout: '60s' },
      );
      return { status: 200, body: toFileDto(row) };
    },
    getFile: async (input) => {
      const id = fileUuid(input.params.fileId);
      // Not read-only: reading a file still `scanning` settles it (files-service `settle`).
      const row = await database.withTenantTx(requireTenant(input), (s) => files.get(s, id));
      return { status: 200, body: toFileDto(row) };
    },
    listProjectPhotos: async (input) => {
      const projectId = decodeId('project', input.params.projectId);
      if (!projectId) throw new AppError('project.not_found');
      const photos = await database.withTenantTx(requireTenant(input), (s) =>
        files.listProjectPhotos(s, projectId, input.query.limit ?? 12),
      );
      return {
        status: 200,
        body: {
          data: photos.map((p) => ({
            file: toFileDto(p.file),
            url: p.url,
            expiresAt: p.expiresAt.toISOString(),
          })),
        },
        headers: { 'cache-control': 'no-store' },
      };
    },
    browseProjectPhotos: async (input) => {
      const projectId = projectOf(input.params.projectId);
      const q = input.query;
      const page = await database.withTenantTx(requireTenant(input), (s) =>
        albums.browse(s, projectId, {
          album: q.album ? (decodeId('photoAlbum', q.album) ?? q.album) : undefined,
          q: q.q?.trim() || undefined,
          from: q.from ? new Date(q.from) : undefined,
          to: q.to ? new Date(q.to) : undefined,
          limit: q.limit ?? 48,
          cursor: decodeCursor(q.cursor),
        }),
      );
      return {
        status: 200,
        body: {
          data: page.items.map((p) => ({
            file: toFileDto(p.file),
            url: p.url,
            expiresAt: p.expiresAt.toISOString(),
            category: p.category,
            filing: p.filing ? toFilingDto(p.filing) : null,
            needsReview: p.needsReview,
            suggestion: p.suggestion
              ? {
                  ...p.suggestion,
                  refId: p.suggestion.refId
                    ? encodeId(REF_ID_KIND[p.suggestion.refKind ?? 'rfi'], p.suggestion.refId)
                    : null,
                  basedOnFileId: encodeId('file', p.suggestion.basedOnFileId),
                }
              : null,
          })),
          next: page.next ? encodeCursor(page.next) : null,
        },
        headers: { 'cache-control': 'no-store' },
      };
    },
    filePhoto: async (input) => {
      const projectId = projectOf(input.params.projectId);
      const fileId = fileUuid(input.params.fileId);
      const b = input.body;
      const refKind = b.refKind ?? null;
      const refId = b.refId && refKind ? decodeId(REF_ID_KIND[refKind], b.refId) : null;
      if (b.refId && !refId)
        throw new AppError('validation_failed', 'That record id is not valid.', [
          { path: 'refId', message: 'Invalid id' },
        ]);
      const row = await database.withTenantTx(requireTenant(input), (s) =>
        albums.fileUnder(
          s,
          projectId,
          fileId,
          { category: b.category, refKind, refId },
          b.fromSuggestion ? 'nova' : 'manual',
        ),
      );
      return { status: 200, body: toFilingDto(row!) };
    },
    listPhotoAlbums: async (input) => {
      const projectId = projectOf(input.params.projectId);
      const res = await database.withTenantTx(requireTenant(input), (s) =>
        albums.listAlbums(s, projectId),
      );
      return {
        status: 200,
        body: {
          auto: res.auto.map((a) => ({
            ...a,
            cover: a.cover
              ? { url: a.cover.url, expiresAt: a.cover.expiresAt.toISOString() }
              : null,
          })),
          own: res.manual.map((a) => ({
            id: encodeId('photoAlbum', a.id),
            name: a.name,
            count: a.count,
            createdAt: a.createdAt.toISOString(),
          })),
        },
        headers: { 'cache-control': 'no-store' },
      };
    },
    createPhotoAlbum: async (input) => {
      const projectId = projectOf(input.params.projectId);
      const row = await database.withTenantTx(requireTenant(input), (s) =>
        albums.createAlbum(s, projectId, input.body.name),
      );
      return {
        status: 201,
        body: {
          id: encodeId('photoAlbum', row.id),
          name: row.name,
          count: 0,
          createdAt: row.createdAt.toISOString(),
        },
      };
    },
    deletePhotoAlbum: async (input) => {
      const projectId = projectOf(input.params.projectId);
      await database.withTenantTx(requireTenant(input), (s) =>
        albums.deleteAlbum(s, projectId, albumUuid(input.params.albumId)),
      );
      return { status: 204 };
    },
    addPhotoToAlbum: async (input) => {
      const projectId = projectOf(input.params.projectId);
      await database.withTenantTx(requireTenant(input), (s) =>
        albums.addToAlbum(
          s,
          projectId,
          albumUuid(input.params.albumId),
          fileUuid(input.params.fileId),
        ),
      );
      return { status: 204 };
    },
    removePhotoFromAlbum: async (input) => {
      const projectId = projectOf(input.params.projectId);
      await database.withTenantTx(requireTenant(input), (s) =>
        albums.removeFromAlbum(
          s,
          projectId,
          albumUuid(input.params.albumId),
          fileUuid(input.params.fileId),
        ),
      );
      return { status: 204 };
    },
    getFileDownload: async (input) => {
      const id = fileUuid(input.params.fileId);
      const link = await database.withTenantTx(requireTenant(input), (s) =>
        files.downloadUrl(s, id),
      );
      return {
        status: 200,
        body: { url: link.url, expiresAt: link.expiresAt.toISOString() },
        headers: { 'cache-control': 'no-store' },
      };
    },
  });
}
