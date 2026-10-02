import { ApiError, unwrap } from '@archova/api-client';
import type { FileObject } from '@archova/contracts';
import { api, ensureCsrfToken } from './api';

export type StoredFile = FileObject;

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Uploads a file the way every client does (backend 04 §2): start an upload, PUT the bytes straight to storage on
 * the presigned URL, then complete it so the API verifies and scans it. Returns the stored file, whose `id` is the
 * `fileId` other endpoints take.
 */
export async function uploadFile(
  orgId: string,
  input: { file: File; projectId: string; module: string },
): Promise<StoredFile> {
  await ensureCsrfToken();
  const sha256 = await sha256Hex(input.file);
  const upload = unwrap(
    await api.POST('/v1/orgs/{orgId}/uploads', {
      params: { path: { orgId }, header: { 'Idempotency-Key': `${input.projectId}:${sha256}` } },
      body: {
        filename: input.file.name,
        mime: input.file.type || 'application/octet-stream',
        sizeBytes: input.file.size,
        sha256,
        projectId: input.projectId,
        module: input.module,
      },
    }),
  );
  const put = await fetch(upload.uploadUrl, {
    method: upload.uploadMethod,
    headers: upload.uploadHeaders,
    body: input.file,
  });
  if (!put.ok) throw new ApiError(put.status, null);
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/uploads/{uploadId}/complete', {
      params: { path: { orgId, uploadId: upload.id } },
    }),
  );
}

/** A short-lived signed URL for reading a stored file (`GET {o}/files/{id}/download`). */
export async function fileDownloadUrl(orgId: string, fileId: string): Promise<string> {
  const link = unwrap(
    await api.GET('/v1/orgs/{orgId}/files/{fileId}/download', {
      params: { path: { orgId, fileId } },
    }),
  );
  return link.url;
}
