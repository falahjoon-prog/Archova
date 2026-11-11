import { decodeId, encodeId } from '@archova/domain';
import type { FileObject } from '@archova/contracts';
import { AppError, defineRoutes, requireTenant, type Database } from '@archova/kernel';
import type { FilesService } from '../application/files-service';
import type { fileObjects, photoTags } from '../infra/tables';
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

const toTagsDto = (t: typeof photoTags.$inferSelect) => ({
  area: t.area,
  trade: t.trade,
  tags: t.tags,
  source: t.source,
});

const fileUuid = (id: string) => {
  const uuid = decodeId('file', id);
  if (!uuid) throw new AppError('file.not_found');
  return uuid;
};

export function filesRoutes(database: Database, files: FilesService) {
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
      const q = input.query;
      const since = q.sinceDays ? new Date(Date.now() - q.sinceDays * 86_400_000) : undefined;
      const r = await database.withTenantTx(requireTenant(input), (s) =>
        files.listProjectPhotos(s, projectId, {
          limit: q.limit ?? 12,
          ...(q.area ? { area: q.area } : {}),
          ...(q.trade ? { trade: q.trade } : {}),
          ...(q.tag ? { tag: q.tag } : {}),
          ...(since ? { since } : {}),
        }),
      );
      return {
        status: 200,
        body: {
          data: r.photos.map((p) => ({
            file: toFileDto(p.file),
            url: p.url,
            expiresAt: p.expiresAt.toISOString(),
            tags: p.tag ? toTagsDto(p.tag) : null,
          })),
          facets: r.facets,
        },
        headers: { 'cache-control': 'no-store' },
      };
    },
    setProjectPhotoTags: async (input) => {
      const projectId = decodeId('project', input.params.projectId);
      if (!projectId) throw new AppError('project.not_found');
      const fid = fileUuid(input.params.fileId);
      const runId = input.body.novaRunId ? decodeId('aiRun', input.body.novaRunId) : null;
      if (input.body.novaRunId && !runId) throw new AppError('validation_failed');
      const row = await database.withTenantTx(requireTenant(input), (s) =>
        files.setPhotoTags(s, projectId, fid, {
          area: input.body.area ?? null,
          trade: input.body.trade ?? null,
          tags: input.body.tags ?? [],
          runId,
        }),
      );
      return { status: 200, body: { tags: row ? toTagsDto(row) : null } };
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
