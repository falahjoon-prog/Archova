import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import type { CreateUploadRequest } from '@archova/contracts';
import { AppError, resolveTimeZone, type Logger, type TenantScope } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { fileObjects, uploadSessions } from '../infra/tables';
import type { ObjectStore } from '../infra/object-store';
import type { MalwareScanner, ScanVerdict } from '../infra/scanner';
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

type FileRow = typeof fileObjects.$inferSelect;

/** What a scan verdict makes the file (backend 06 §3). */
const FILE_STATUS = {
  clean: 'ready',
  infected: 'infected',
  unscannable: 'failed',
  pending: 'scanning',
} as const satisfies Record<ScanVerdict, FileRow['status']>;

/** No scan result after this long fails closed (security-licensing/09 §4). */
const SCAN_TIMEOUT_MS = 15 * 60_000;

/**
 * Nothing reads a file before it's `ready` (security-licensing/09 §4). `file.not_ready` (409) means still being
 * scanned, so retry; `file.blocked` (422) is final: infected or couldn't be scanned.
 */
export function assertFileReady(f: Pick<FileRow, 'status'>) {
  if (f.status === 'scanning')
    throw new AppError('file.not_ready', 'This file is still being checked. Try again shortly.');
  if (f.status !== 'ready')
    throw new AppError(
      'file.blocked',
      f.status === 'infected'
        ? 'This file was blocked because it may contain malware.'
        : "This file couldn't be checked for malware, so it can't be used. Upload it again; password-protected files can't be checked.",
    );
}

export interface FilesDeps {
  access: AccessService;
  store: ObjectStore;
  scanner: MalwareScanner;
  logger: Logger;
  /**
   * Uploads a feature module owns, checked with that module's key instead of `files.objects.upload`: a worker
   * photographing their white card during an induction holds no documents permission (backend 06 §5).
   */
  uploadPermissions?: Readonly<Record<string, string>>;
}

/**
 * Upload pipeline (backend 06 §3). Files go client → S3 directly via a presigned PUT; the API never streams bytes.
 * Phase 0 runs verification, scanning and the move out of quarantine inline in `complete`; the files worker takes
 * this over from the S3 event (same function) when apps/worker lands, adding renditions and EXIF.
 */
export function createFilesService({
  access,
  store,
  scanner,
  logger,
  uploadPermissions = {},
}: FilesDeps) {
  async function authorise(
    scope: TenantScope,
    projectId: string | null,
    action: 'upload' | 'read',
    module?: string,
  ) {
    if (projectId) {
      const own = action === 'upload' && module ? uploadPermissions[module] : undefined;
      await access.assert(
        scope,
        own ?? (action === 'upload' ? 'files.objects.upload' : 'files.objects.read'),
        { projectId },
      );
    } else if (action === 'upload') {
      await access.assert(scope, 'files.org_objects.upload');
    } else if (scope.ctx.principalType !== 'member') {
      // Org-level files (logos, templates) are visible to org members, never to external collaborators.
      throw new AppError('file.not_found');
    }
  }

  /**
   * `authorised`: the caller has already checked access some other way (an access link, X45), so the member
   * permission check is skipped. Only module code passes it; routes never do.
   */
  async function createUpload(
    scope: TenantScope,
    input: Omit<CreateUploadRequest, 'projectId'> & { projectId: string | null },
    opts: { authorised?: boolean } = {},
  ) {
    if (!opts.authorised) await authorise(scope, input.projectId, 'upload', input.module);
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
    if (session.status === 'uploaded' && session.fileId)
      return settle(scope, await getFileRow(scope, session.fileId));
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
    if (verdict === 'clean') await release(session.quarantineKey, key);
    else logVerdict(scope, verdict, { uploadId });

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
        status: FILE_STATUS[verdict],
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
    if (verdict === 'clean') emitReady(scope, row!);
    return row!;
  }

  async function readOnly(scope: TenantScope) {
    const r = await scope.tx.execute<{ ro: string }>(
      sql`select current_setting('transaction_read_only') as ro`,
    );
    return r.rows[0]?.ro === 'on';
  }

  /** Clean: copy out of quarantine to the org key, then drop the quarantine copy. */
  async function release(from: string, to: string) {
    await store.copy(from, to);
    await store.delete(from);
  }

  function logVerdict(scope: TenantScope, verdict: ScanVerdict, ids: Record<string, string>) {
    // Infected and unscannable files stay in quarantine for 30 days for investigation, never served
    // (security-licensing/09 §4). Notifying the uploader and admins comes with the notifications module.
    if (verdict === 'infected')
      logger.warn({ orgId: scope.ctx.orgId, ...ids }, 'infected upload quarantined');
    if (verdict === 'unscannable')
      logger.warn({ orgId: scope.ctx.orgId, ...ids }, 'upload could not be scanned');
  }

  function emitReady(scope: TenantScope, f: FileRow) {
    scope.events.add({
      type: 'files.object.ready.v1',
      projectId: f.projectId,
      entityType: 'file',
      entityId: f.id,
      entityVersion: f.version,
      data: { fileId: f.id, projectId: f.projectId, module: f.module, mime: f.mime },
    });
  }

  /**
   * A file still `scanning` (the engine hadn't tagged it when the upload completed) is settled on the next read:
   * clean files move out of quarantine and become `ready`; no result after SCAN_TIMEOUT_MS fails closed.
   * The files worker takes this over with a sweep when apps/worker lands.
   */
  async function settle(scope: TenantScope, f: FileRow): Promise<FileRow> {
    if (f.status !== 'scanning' || (await readOnly(scope))) return f;
    let verdict = await scanner.scan(f.storageKey);
    if (verdict === 'pending' && Date.now() - f.createdAt.getTime() > SCAN_TIMEOUT_MS)
      verdict = 'unscannable';
    if (verdict === 'pending') return f;
    const key = storageKey({
      orgId: f.orgId,
      projectId: f.projectId,
      module: f.module,
      fileId: f.id,
    });
    if (verdict === 'clean') await release(f.storageKey, key);
    else logVerdict(scope, verdict, { fileId: f.id });
    const [row] = await scope.tx
      .update(fileObjects)
      .set({
        status: FILE_STATUS[verdict],
        storageKey: verdict === 'clean' ? key : f.storageKey,
        version: f.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(fileObjects.id, f.id), eq(fileObjects.status, 'scanning')))
      .returning();
    // Another request settled it first.
    if (!row) return getFileRow(scope, f.id);
    if (verdict === 'clean') emitReady(scope, row);
    return row;
  }

  /**
   * Phase 0 resolver: project files need `files.objects.read` on the project. Feature modules will register
   * record resolvers so a file is visible exactly when the record it belongs to is (backend 06 §5).
   */
  async function get(scope: TenantScope, fileId: string, opts: { authorised?: boolean } = {}) {
    const f = await getFileRow(scope, fileId);
    if (!opts.authorised) await authorise(scope, f.projectId, 'read');
    return settle(scope, f);
  }

  async function downloadUrl(
    scope: TenantScope,
    fileId: string,
    opts: { authorised?: boolean; expiresInS?: number; contentType?: string } = {},
  ) {
    const f = await get(scope, fileId, opts);
    assertFileReady(f);
    // A caller can ask for a shorter life (never a longer one).
    const ttl = Math.min(DOWNLOAD_URL_TTL_S, Math.max(1, opts.expiresInS ?? DOWNLOAD_URL_TTL_S));
    const url = await store.presignGet(f.storageKey, {
      contentDisposition: contentDisposition(f.filename),
      expiresInS: ttl,
      contentType: opts.contentType,
    });
    return { url, expiresAt: new Date(Date.now() + ttl * 1000) };
  }

  /**
   * The file's bytes for server-side processing, after the same read check as a download. Capped so one request
   * can't pull a huge file into memory; bigger files wait for the worker. `authorised` is for background jobs
   * that run as the system principal on a record another check already covers; routes never pass it.
   */
  async function readBytes(
    scope: TenantScope,
    fileId: string,
    maxBytes: number,
    opts: { authorised?: boolean } = {},
  ) {
    const f = await get(scope, fileId, opts);
    assertFileReady(f);
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
