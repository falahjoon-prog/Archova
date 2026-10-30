// How the engine reaches the API. The app implements it with @archova/api-client (bearer auth, token
// refresh); tests use FakeSyncServer.

import type { DrainGrant, PullRequest, PullResponse, PushRequest, PushResponse } from './wire';

export interface SyncTransport {
  pull(request: PullRequest): Promise<PullResponse>;
  /** `drain` sends with the drain-only grant (X38); `grant` is its token's source, absent if the device never got one. */
  push(
    request: PushRequest,
    options: { drain: boolean; grant?: DrainGrant },
  ): Promise<PushResponse>;
}

/**
 * A failed request. `status` 0 is a network failure (no response). Transports throw this so the engine can
 * tell retryable failures from ones that need the user.
 */
export class SyncHttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly retryAfterMs: number | undefined;
  /** The drain-only grant that came with an `access.revoked` problem (X38). */
  readonly drainGrant: DrainGrant | undefined;

  constructor(
    status: number,
    options: {
      code?: string;
      retryAfterMs?: number;
      message?: string;
      drainGrant?: DrainGrant;
    } = {},
  ) {
    super(options.message ?? `Sync request failed with status ${status}`);
    this.name = 'SyncHttpError';
    this.status = status;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.drainGrant = options.drainGrant;
  }
}

export type FailureKind =
  /** Offline, timeout, 408, 429 or 5xx: back off and retry. */
  | 'retry'
  /** 401: the session needs a refresh or a new sign-in. */
  | 'auth'
  /** 426 `app.upgrade_required`: the build is older than the support window (X39). */
  | 'upgrade'
  /** Anything else: a bug or a contract mismatch; retried with backoff but reported. */
  | 'fatal';

export function classifyFailure(error: unknown): FailureKind {
  if (!(error instanceof SyncHttpError)) return 'retry';
  const { status } = error;
  // The scan has not finished: the command is fine, try again later.
  if (error.code === 'file.not_ready') return 'retry';
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retry';
  if (status === 401) return 'auth';
  if (status === 426) return 'upgrade';
  return 'fatal';
}

/** Parse a `Retry-After` header (seconds or HTTP date) into milliseconds from `nowMs`. */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs: number,
): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, at - nowMs);
}
