import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { CreateUploadRequest } from '@archova/contracts';
import { AppError, resolveTimeZone, type Logger, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fileObjects, uploadSessions } from '../infra/tables';
import type { ObjectStore } from '../infra/object-store';
import type { MalwareScanner } from '../infra/scanner';
import {
  ALLOWED_MIME_TYPES,
  DOWNLOAD_URL_TTL_S,
  MAX_UPLOAD_BYTES,
  UPLOAD_SESSION_TTL_MS,
  contentDisposition,
  hexToBase64,
  quarantineKey,
  storageKey,
} from '../domain/rules';
import { captureToRow, pickCapture } from '../domain/capture';

export interface FilesDeps {
  access: AccessService;
  store: ObjectStore;
  scanner: MalwareScanner;
  logger: Logger;
}

/**
 * Upload pipeline (backend 06 §3). Files go client → S3 directly via a presigned PUT; the API never streams bytes.
 * Phase 0 runs verification, scanning and the move out of quarantine inline in `complete`; the files worker takes
 * this over from the S3 event (same function) when apps/worker lands, adding renditions and EXIF.
 */
export function createFilesService({ access, store, scanner, logger }: FilesDeps) {
  async function authorise(
    scope: TenantScope,
    projectId: string | null,
    action: 'upload' | 'read',
  ) {
    if (projectId) {
      await access.assert(
        scope,
        action === 'upload' ? 'files.objects.upload' : 'files.objects.read',
        { projectId },
      );
    } else if (action === 'upload') {
      await access.assert(scope, 'files.org_objects.upload');
    } else if (scope.ctx.principalType !== 'member') {
      // Org-level files (logos, templates) are visible to org members, never to external collaborators.
      throw new AppError('file.not_found');
    }
  }

  async function createUpload(
    scope: TenantScope,
    input: Omit<CreateUploadRequest, 'projectId'> & { projectId: string | null },
  ) {
    await authorise(scope, input.projectId, 'upload');
    if (!ALLOWED_MIME_TYPES.has(input.mime)) {
      throw new AppError(
        'upload.mime_not_allowed',
        `Files of type ${input.mime} can't be uploaded.`,
      );
    }
    if (input.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new AppError('validation_failed', 'Files can be at most 5 GB.', [
        { path: 'sizeBytes', message: 'Too large' },
      ]);
    }
    // Storage limit check (Sam 06 §5) lands with billing usage records.
    const captureTz = input.capture?.timeZone
      ? await resolveTimeZone(scope.tx, input.capture.timeZone, 'capture.timeZone')
      : null;
    const id = uuidv7();
    const key = quarantineKey(id);
    const expiresAt = new Date(Date.now() + UPLOAD_SESSION_TTL_MS);
    await scope.tx.insert(uploadSessions).values({
      id,
      orgId: scope.ctx.orgId,
      projectId: input.projectId,
      module: input.module,
      filename: input.filename,
      mime: input.mime,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      quarantineKey: key,
      status: 'pending',
      expiresAt,
      ...captureToRow(input.capture, captureTz),
      createdBy: scope.ctx.userId,
      updatedBy: scope.ctx.userId,
    });
    const presigned = await store.presignPut(key, {
      contentType: input.mime,
      contentLength: input.sizeBytes,
      sha256Base64: hexToBase64(input.sha256),
      expiresInS: Math.floor(UPLOAD_SESSION_TTL_MS / 1000),
    });
    return {
      id,
      status: 'pending' as const,
      uploadUrl: presigned.url,
      uploadHeaders: presigned.headers,
      expiresAt,
    };
  }

  async function getUploadSession(scope: TenantScope, uploadId: string) {
    const [s] = await scope.tx
      .select()
      .from(uploadSessions)
      .where(eq(uploadSessions.id, uploadId))
      .limit(1);
    // Only the uploader can complete their upload.
    if (!s || s.createdBy !== scope.ctx.userId) throw new AppError('upload.not_found');
    return s;
  }

  async function getFileRow(scope: TenantScope, fileId: string) {
    const [f] = await scope.tx
      .select()
      .from(fileObjects)
      .where(and(eq(fileObjects.id, fileId), isNull(fileObjects.deletedAt)))
      .limit(1);
    if (!f) throw new AppError('file.not_found');
    return f;
  }

  async function complete(scope: TenantScope, uploadId: string) {
    const session = await getUploadSession(scope, uploadId);
    if (session.status === 'uploaded' && session.fileId) return getFileRow(scope, session.fileId);
    if (session.expiresAt < new Date())
      throw new AppError('upload.expired', 'This upload expired. Start it again.');

    const head = await store.head(session.quarantineKey);
    if (!head) throw new AppError('upload.not_received', "We haven't received the file yet.");
    if (head.size !== session.sizeBytes)
      throw new AppError('upload.size_mismatch', 'The uploaded file size does not match.');
    if (head.sha256Base64 && head.sha256Base64 !== hexToBase64(session.sha256)) {
      throw new AppError('upload.checksum_mismatch', 'The uploaded file is corrupted. Try again.');
    }

    const fileId = uuidv7();
    const verdict = await scanner.scan(session.quarantineKey);
    const key = storageKey({
      orgId: scope.ctx.orgId,
      projectId: session.projectId,
      module: session.module,
      fileId,
    });
    if (verdict === 'clean') {
      await store.copy(session.quarantineKey, key);
      await store.delete(session.quarantineKey);
    } else {
      // Infected: kept in quarantine for 30 days for investigation, never downloadable (backend 06 §3).
      logger.warn({ orgId: scope.ctx.orgId, uploadId }, 'infected upload quarantined');
    }

    const [dupe] = await scope.tx
      .select({ id: fileObjects.id })
      .from(fileObjects)
      .where(
        and(
          eq(fileObjects.sha256, session.sha256),
          eq(fileObjects.status, 'ready'),
          isNull(fileObjects.deletedAt),
        ),
      )
      .limit(1);

    const [row] = await scope.tx
      .insert(fileObjects)
      .values({
        id: fileId,
        orgId: scope.ctx.orgId,
        projectId: session.projectId,
        module: session.module,
        storageKey: verdict === 'clean' ? key : session.quarantineKey,
        filename: session.filename,
        mime: session.mime,
        sizeBytes: session.sizeBytes,
        sha256: session.sha256,
        status: verdict === 'clean' ? 'ready' : 'infected',
        dedupeOf: dupe?.id ?? null,
        ...pickCapture(session),
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      })
      .returning();
    await scope.tx
      .update(uploadSessions)
      .set({ status: 'uploaded', fileId, updatedBy: scope.ctx.userId })
      .where(eq(uploadSessions.id, uploadId));
    if (verdict === 'clean') {
      scope.events.add({
        type: 'files.object.ready.v1',
        projectId: session.projectId,
        entityType: 'file',
        entityId: fileId,
        entityVersion: 1,
        data: { fileId, projectId: session.projectId, module: session.module, mime: session.mime },
      });
    }
    return row!;
  }

  /**
   * Phase 0 resolver: project files need `files.objects.read` on the project. Feature modules will register
   * record resolvers so a file is visible exactly when the record it belongs to is (backend 06 §5).
   */
  async function get(scope: TenantScope, fileId: string) {
    const f = await getFileRow(scope, fileId);
    await authorise(scope, f.projectId, 'read');
    return f;
  }

  async function downloadUrl(scope: TenantScope, fileId: string) {
    const f = await get(scope, fileId);
    if (f.status !== 'ready')
      throw new AppError('file.not_ready', 'This file is not available for download.');
    const url = await store.presignGet(f.storageKey, {
      contentDisposition: contentDisposition(f.filename),
      expiresInS: DOWNLOAD_URL_TTL_S,
    });
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_S * 1000) };
  }

  /**
   * The file's bytes for server-side processing, after the same read check as a download. Capped so one request
   * can't pull a huge file into memory; bigger files wait for the worker.
   */
  async function readBytes(scope: TenantScope, fileId: string, maxBytes: number) {
    const f = await get(scope, fileId);
    if (f.status !== 'ready')
      throw new AppError('file.not_ready', 'This file is not available yet.');
    if (f.sizeBytes > maxBytes)
      throw new AppError('validation_failed', 'This file is too large to process here.', [
        { path: 'fileId', message: `Larger than ${Math.round(maxBytes / 1e6)} MB` },
      ]);
    const bytes = await store.get(f.storageKey);
    if (!bytes) throw new AppError('file.not_ready', 'This file is not available yet.');
    return { file: f, bytes };
  }

  return { createUpload, complete, get, downloadUrl, readBytes };
}

export type FilesService = ReturnType<typeof createFilesService>;
