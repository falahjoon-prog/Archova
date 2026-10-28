// Upload rules (backend 06 §3). Keys never contain user-controlled names (backend 06 §2).

export const MAX_UPLOAD_BYTES = 5 * 1024 ** 3;
export const UPLOAD_SESSION_TTL_MS = 60 * 60 * 1000;
export const DOWNLOAD_URL_TTL_S = 5 * 60;

export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
  'image/tiff',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-project',
  'image/vnd.dwg',
  'image/vnd.dxf',
  'application/acad',
  'model/ifc',
  'application/x-step',
  'video/mp4',
  'video/quicktime',
]);

export const quarantineKey = (uploadId: string) => `quarantine/${uploadId}`;

/** Where infected and unscannable objects are kept for investigation (30-day lifecycle on the prefix; backend 06 §3). */
export const threatKey = (orgId: string, fileId: string) => `threats/${orgId}/${fileId}`;

/** `orgs/{orgId}/projects/{projectId}/{module}/{fileId}/original` or `orgs/{orgId}/_org/{module}/{fileId}/original` (X22). */
export function storageKey(p: {
  orgId: string;
  projectId: string | null;
  module: string;
  fileId: string;
}): string {
  if (!/^[a-z_]{2,32}$/.test(p.module)) throw new Error(`Bad module name ${p.module}`);
  const scope = p.projectId ? `projects/${p.projectId}` : '_org';
  return `orgs/${p.orgId}/${scope}/${p.module}/${p.fileId}/original`;
}

/** `Content-Disposition` for downloads; the original filename is metadata only. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** Hex SHA-256 → base64, the form S3 uses for `x-amz-checksum-sha256`. */
export const hexToBase64 = (hex: string) => Buffer.from(hex, 'hex').toString('base64');
