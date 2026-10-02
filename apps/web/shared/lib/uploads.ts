import { ApiError, unwrap } from '@archova/api-client';
import type { FileObject } from '@archova/contracts';
import { api, ensureCsrfToken } from './api';

export type StoredFile = FileObject;

async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Waits between checks while a new file is scanned for malware: quick at first, then every 5 s, about 2 minutes in all. */
const SCAN_WAITS_MS = [1000, 2000, 3000, ...Array<number>(23).fill(5000)];

function blocked(status: number, code: string, detail: string): ApiError {
  return new ApiError(status, {
    type: 'about:blank',
    title: detail,
    status,
    detail,
    code,
  } as never);
}

/**
 * A completed upload is `scanning` until the malware scan finishes (Ben, 2 Oct 2026); other endpoints refuse it
 * with 409 `file.not_ready` until then. `infected` and `failed` are final.
 */
export async function untilScanned(
  orgId: string,
  file: StoredFile,
  waitsMs: readonly number[] = SCAN_WAITS_MS,
): Promise<StoredFile> {
  let current = file;
  for (const ms of waitsMs) {
    if (current.status === 'ready') return current;
    if (current.status === 'infected')
      throw blocked(
        422,
        'file.blocked',
        `${current.filename} didn't pass the virus check, so it wasn't added.`,
      );
    if (current.status === 'failed')
      throw blocked(
        422,
        'file.blocked',
        `${current.filename} couldn't be checked for viruses, so it wasn't added. Try uploading it again.`,
      );
    await new Promise((resolve) => setTimeout(resolve, ms));
    current = unwrap(
      await api.GET('/v1/orgs/{orgId}/files/{fileId}', {
        params: { path: { orgId, fileId: current.id } },
      }),
    );
  }
  if (current.status === 'ready') return current;
  throw blocked(
    504,
    'file.not_ready',
    `${current.filename} is still being checked for viruses. Try again in a minute.`,
  );
}

/**
 * Uploads a file the way every client does (backend 04 §2): start an upload, PUT the bytes straight to storage on
 * the presigned URL, then complete it so the API verifies and scans it. Resolves once the scan has passed, with
 * the stored file, whose `id` is the `fileId` other endpoints take.
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
  const stored = unwrap(
    await api.POST('/v1/orgs/{orgId}/uploads/{uploadId}/complete', {
      params: { path: { orgId, uploadId: upload.id } },
    }),
  );
  return untilScanned(orgId, stored);
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
