// The file queue (mobile 02 §2.3, 03 §3.1): photos and attachments go straight to storage through presigned
// URLs, never through the API. A file stays on the device until the server has stored it. The command that
// references it (for example `photos.create`) waits in the outbox as `held`, and is released with the file's
// id in the same transaction that marks the upload complete; anything depending on it waits until then.

import type { Capture, CreateUploadRequest, FileObject, Upload } from '@archova/contracts';
import type { SqlDatabase, SqlExecutor } from '../db/sql';
import type { SqliteSyncStore } from '../db/sync-store';

export type FileState =
  /** Waiting for an upload session. */
  | 'queued'
  /** Has a presigned URL; the bytes are not confirmed yet. */
  | 'uploading'
  /** Bytes are in storage; the API has not been told yet. */
  | 'uploaded'
  /** The API stored it; `fileId` is set and the follow-up command is queued. */
  | 'completed'
  /** The server refused the file (infected, too large); shown under "Needs attention". */
  | 'failed';

export interface QueuedFile {
  id: string;
  projectId: string | null;
  module: string;
  localUri: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  capture: Capture | null;
  state: FileState;
  fileId: string | null;
  attempts: number;
  lastError: string | null;
}

export interface NewQueuedFile {
  id: string;
  projectId: string | null;
  module: string;
  localUri: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  capture: Capture | null;
  /** The held outbox entry to release with `{ fileId }` once the file is stored. */
  releases: string | null;
}

/** The two upload operations, called through @archova/api-client (see lib/files/api.ts). */
export interface UploadApi {
  createUpload(body: CreateUploadRequest, idempotencyKey: string): Promise<Upload>;
  completeUpload(uploadId: string): Promise<FileObject>;
}

/** Sends the bytes to the presigned URL, in a native background session where the OS allows. */
export interface FileTransfer {
  put(url: string, headers: Record<string, string>, localUri: string): Promise<{ status: number }>;
}

interface Row {
  id: string;
  project_id: string | null;
  module: string;
  local_uri: string;
  filename: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  capture: string | null;
  state: FileState;
  upload_key: string;
  upload_id: string | null;
  upload_url: string | null;
  upload_headers: string | null;
  upload_expires_at: string | null;
  file_id: string | null;
  release_mutation: string | null;
  attempts: number;
  last_error: string | null;
}

function toFile(row: Row): QueuedFile {
  return {
    id: row.id,
    projectId: row.project_id,
    module: row.module,
    localUri: row.local_uri,
    filename: row.filename,
    mime: row.mime,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    capture: row.capture === null ? null : (JSON.parse(row.capture) as Capture),
    state: row.state,
    fileId: row.file_id,
    attempts: row.attempts,
    lastError: row.last_error,
  };
}

/** Thrown by UploadApi implementations for HTTP failures, so the queue can tell retryable from final. */
export class UploadHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null = null,
  ) {
    super(`Upload request failed with ${status}${code ? ` (${code})` : ''}`);
    this.name = 'UploadHttpError';
  }
}

const isRetryable = (error: unknown) =>
  !(error instanceof UploadHttpError) ||
  error.status === 0 ||
  error.status === 401 ||
  error.status === 408 ||
  error.status === 429 ||
  error.status >= 500;

/** Refresh the presigned URL when it has less than this left. */
const URL_SAFETY_MS = 60_000;

export interface DrainResult {
  completed: number;
  failed: number;
  /** An item hit a retryable failure (offline, 5xx); try again later. */
  retry: boolean;
}

export class UploadQueue {
  constructor(
    private readonly db: SqlDatabase,
    private readonly store: SqliteSyncStore,
    private readonly api: UploadApi,
    private readonly transfer: FileTransfer,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queue a file inside the caller's transaction (alongside the record it belongs to). */
  async addIn(tx: SqlExecutor, file: NewQueuedFile): Promise<void> {
    const at = new Date(this.now()).toISOString();
    await tx.runAsync(
      `INSERT INTO file_queue (id, project_id, module, local_uri, filename, mime, size_bytes, sha256, capture,
                               state, upload_key, release_mutation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)`,
      [
        file.id,
        file.projectId,
        file.module,
        file.localUri,
        file.filename,
        file.mime,
        file.sizeBytes,
        file.sha256,
        file.capture === null ? null : JSON.stringify(file.capture),
        file.id,
        file.releases,
        at,
        at,
      ],
    );
  }

  async list(filter: { states?: FileState[] } = {}): Promise<QueuedFile[]> {
    const states = filter.states ?? [];
    const rows = await this.db.getAllAsync<Row>(
      states.length === 0
        ? 'SELECT * FROM file_queue ORDER BY created_at, id'
        : `SELECT * FROM file_queue WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at, id`,
      states,
    );
    return rows.map(toFile);
  }

  /** Files not yet stored by the server, for "N items waiting to sync". */
  async waitingCount(): Promise<number> {
    const row = await this.db.getFirstAsync<{ n: number }>(
      `SELECT count(*) AS n FROM file_queue WHERE state IN ('queued', 'uploading', 'uploaded')`,
    );
    return row?.n ?? 0;
  }

  /**
   * Move every waiting file as far as it can go. Stops at the first retryable failure (usually no signal),
   * since the next file would fail the same way.
   */
  async drain(): Promise<DrainResult> {
    const result: DrainResult = { completed: 0, failed: 0, retry: false };
    const rows = await this.db.getAllAsync<Row>(
      `SELECT * FROM file_queue WHERE state IN ('queued', 'uploading', 'uploaded') ORDER BY created_at, id`,
    );
    for (const row of rows) {
      try {
        const state = await this.advance(row);
        if (state === 'completed') result.completed++;
        if (state === 'failed') result.failed++;
      } catch (error) {
        if (isRetryable(error)) {
          await this.db.runAsync(
            `UPDATE file_queue SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`,
            [String(error instanceof Error ? error.message : error), this.iso(), row.id],
          );
          result.retry = true;
          break;
        }
        await this.fail(
          row.id,
          error instanceof UploadHttpError ? (error.code ?? `http_${error.status}`) : 'error',
        );
        result.failed++;
      }
    }
    return result;
  }

  /** Remove a failed file the user discarded, with the local record it was for. */
  async discard(id: string): Promise<void> {
    await this.db.runAsync(
      `DELETE FROM file_queue WHERE id = ? AND state IN ('failed', 'completed')`,
      [id],
    );
  }

  private async advance(row: Row): Promise<FileState> {
    let current = row;
    if (current.state === 'uploading' && this.expired(current)) {
      // A new session needs a new idempotency key, or the API would return the expired one.
      current = await this.update(current.id, {
        state: 'queued',
        upload_key: `${current.id}.${current.attempts + 1}`,
      });
    }
    if (current.state === 'queued') {
      const upload = await this.api.createUpload(
        {
          filename: current.filename,
          mime: current.mime,
          sizeBytes: current.size_bytes,
          sha256: current.sha256,
          module: current.module,
          ...(current.project_id ? { projectId: current.project_id } : {}),
          ...(current.capture ? { capture: JSON.parse(current.capture) as Capture } : {}),
        },
        current.upload_key,
      );
      current = await this.update(current.id, {
        state: 'uploading',
        upload_id: upload.id,
        upload_url: upload.uploadUrl,
        upload_headers: JSON.stringify(upload.uploadHeaders),
        upload_expires_at: upload.expiresAt,
      });
    }
    if (current.state === 'uploading') {
      const headers = JSON.parse(current.upload_headers ?? '{}') as Record<string, string>;
      const { status } = await this.transfer.put(current.upload_url!, headers, current.local_uri);
      if (status === 403) {
        // Storage refused the URL (expired or clock skew): start a fresh session next time.
        await this.update(current.id, {
          state: 'queued',
          upload_key: `${current.id}.${current.attempts + 1}`,
        });
        throw new UploadHttpError(0, 'upload_url_rejected');
      }
      if (status < 200 || status >= 300) throw new UploadHttpError(status >= 500 ? status : 0);
      current = await this.update(current.id, { state: 'uploaded' });
    }
    if (current.state === 'uploaded') {
      const file = await this.api.completeUpload(current.upload_id!);
      if (file.status === 'infected' || file.status === 'failed') {
        await this.fail(current.id, `file_${file.status}`);
        return 'failed';
      }
      await this.complete(current, file.id);
      return 'completed';
    }
    return current.state;
  }

  private async complete(row: Row, fileId: string) {
    await this.db.withExclusiveTransactionAsync(async (tx) => {
      await tx.runAsync(
        `UPDATE file_queue SET state = 'completed', file_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`,
        [fileId, this.iso(), row.id],
      );
      if (row.release_mutation !== null) {
        await this.store.releaseIn(tx, row.release_mutation, { fileId });
      }
    });
  }

  /** The server refused the file: its held command goes to "Needs attention" with the reason. */
  private async fail(id: string, reason: string) {
    const row = await this.update(id, { state: 'failed', last_error: reason });
    if (row.release_mutation !== null) {
      await this.store.markNeedsAttention([
        {
          mutationId: row.release_mutation,
          reason: { kind: 'rejected', problem: { code: reason } },
        },
      ]);
    }
  }

  private expired(row: Row) {
    return (
      row.upload_expires_at === null ||
      Date.parse(row.upload_expires_at) - URL_SAFETY_MS <= this.now()
    );
  }

  private async update(id: string, fields: Partial<Row>): Promise<Row> {
    const entries = Object.entries(fields);
    await this.db.runAsync(
      `UPDATE file_queue SET ${entries.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
      [...entries.map(([, v]) => v as string | number | null), this.iso(), id],
    );
    return (await this.db.getFirstAsync<Row>('SELECT * FROM file_queue WHERE id = ?', [id]))!;
  }

  private iso() {
    return new Date(this.now()).toISOString();
  }
}
