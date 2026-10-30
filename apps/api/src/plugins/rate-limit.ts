import { tenantKey, type RedisClient } from '@archova/kernel';

// Public API limits (integrations/06 §3): a sliding window per token and per org, counted in Redis. The window is
// one minute and is approximated from two fixed buckets (this minute plus the last minute's count, weighted by how
// much of it still overlaps), so a client cannot double its rate by straddling a boundary.
const WINDOW_S = 60;

export interface RateDecision {
  limit: number;
  remaining: number;
  /** Seconds until the window has room again. */
  resetS: number;
  allowed: boolean;
}

export function apiRateLimiter(redis: RedisClient, nowMs: () => number = Date.now) {
  async function hit(orgId: string, subject: string, limit: number): Promise<RateDecision> {
    const t = nowMs() / 1000;
    const bucket = Math.floor(t / WINDOW_S);
    const cur = tenantKey(orgId, 'apirl', subject, String(bucket));
    const prev = tenantKey(orgId, 'apirl', subject, String(bucket - 1));
    const used = await redis.incr(cur);
    if (used === 1) await redis.expire(cur, WINDOW_S * 2);
    const before = Number((await redis.get(prev)) ?? 0);
    const elapsed = (t % WINDOW_S) / WINDOW_S;
    const estimate = Math.ceil(before * (1 - elapsed) + used);
    const remaining = Math.max(0, limit - estimate);
    const untilBucketEnd = Math.ceil(WINDOW_S - (t % WINDOW_S));
    return { limit, remaining, resetS: untilBucketEnd, allowed: estimate <= limit };
  }
  return { hit };
}

export type ApiRateLimiter = ReturnType<typeof apiRateLimiter>;

/** The tighter of two decisions, for the `RateLimit-*` headers. */
export const tighter = (a: RateDecision, b: RateDecision) => (b.remaining < a.remaining ? b : a);
