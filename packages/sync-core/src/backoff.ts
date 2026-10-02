// Capped exponential backoff with full jitter (02 §2.9), so devices don't stampede after an outage.

export interface BackoffOptions {
  baseMs: number;
  capMs: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 2_000, capMs: 5 * 60_000 };

/**
 * Delay before retry number `attempt` (1-based): uniform in [0, min(cap, base * 2^(attempt-1))].
 * A server `Retry-After` is a floor, never shortened by jitter.
 */
export function backoffDelay(
  attempt: number,
  random: () => number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  retryAfterMs?: number,
): number {
  const ceiling = Math.min(options.capMs, options.baseMs * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.floor(random() * ceiling);
  return retryAfterMs === undefined ? jittered : Math.max(retryAfterMs, jittered);
}
