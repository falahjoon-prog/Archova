// "Tell me once a day": for a limit an org can hit over and over (every refused call, every retried job), the log
// should say so once per org, limit and day so an alert fires on the org, not on the retries. Redis makes it once
// across processes; without Redis (local development) it is once per process.
import { tenantKey, type RedisClient } from '@archova/kernel';

export interface OnceADay {
  /** True the first time it is asked for this org, limit and day; `day` is any string that changes daily. */
  first(orgId: string, limit: string, day: string): Promise<boolean>;
}

/** Longer than a day, so a marker outlives its day in any zone and expires on its own. */
const MARKER_TTL_S = 36 * 3600;

export function createOnceADay(redis: Pick<RedisClient, 'set'> | null): OnceADay {
  const seen = new Map<string, string>();
  return {
    async first(orgId, limit, day) {
      if (redis) {
        try {
          return (
            (await redis.set(
              tenantKey(orgId, 'ai', 'once', limit, day),
              '1',
              'EX',
              MARKER_TTL_S,
              'NX',
            )) === 'OK'
          );
        } catch {
          // A log line is not worth failing a request over, nor worth silence: say it again.
          return true;
        }
      }
      const key = `${orgId}:${limit}`;
      if (seen.get(key) === day) return false;
      seen.set(key, day);
      return true;
    },
  };
}
