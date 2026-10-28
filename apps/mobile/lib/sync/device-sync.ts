// One sync run on the device: move waiting files first (their follow-up commands join the outbox when they
// land), then run the sync engine. The engine is null only in tests that exercise files alone.

import {
  backoffDelay,
  DEFAULT_BACKOFF,
  type SyncEngine,
  type SyncOutcome,
  type SyncRunOptions,
  type Syncable,
} from '@archova/sync-core';
import type { UploadQueue } from '../files/upload-queue';

export function createDeviceSync(deps: {
  uploads: UploadQueue;
  engine: SyncEngine | null;
  now?: () => number;
  random?: () => number;
}): Syncable {
  const now = deps.now ?? Date.now;
  const random = deps.random ?? Math.random;
  let uploadFailures = 0;

  return {
    async sync(options: SyncRunOptions = {}): Promise<SyncOutcome> {
      let uploadRetry = false;
      try {
        uploadRetry = (await deps.uploads.drain()).retry;
      } catch {
        uploadRetry = true;
      }
      uploadFailures = uploadRetry ? uploadFailures + 1 : 0;

      const outcome = deps.engine ? await deps.engine.sync(options) : ({ ok: true } as const);
      if (!outcome.ok || !uploadRetry) return outcome;
      return {
        ok: false,
        kind: 'retry',
        retryAt: now() + backoffDelay(uploadFailures, random, DEFAULT_BACKOFF),
        error: new Error('A file upload is waiting for a connection'),
      };
    },
  };
}
