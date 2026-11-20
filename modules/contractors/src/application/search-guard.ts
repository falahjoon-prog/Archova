import type { Logger, RedisClient } from '@archova/kernel';
import { AppError } from '@archova/kernel';

/** Searches per account per minute, per day, and per day for an account under a day old. */
export const SEARCH_PER_MINUTE = 20;
export const SEARCH_PER_DAY = 200;
export const SEARCH_PER_DAY_NEW_ACCOUNT = 30;
/** Distinct search terms in one day that look like someone walking the directory. */
export const SWEEP_ALERT_TERMS = 40;
const NEW_ACCOUNT_MS = 24 * 3_600_000;

/**
 * Company-search limiter (Sam 20 Nov, item 2): counted in Redis so every API instance shares it, with an in-process
 * fallback where Redis is not configured (local dev). Logs a warning when one account tries many distinct terms.
 */
export function createSearchGuard(deps: {
  redis: RedisClient | null;
  logger: Pick<Logger, 'warn'>;
  now?: () => Date;
}) {
  const now = deps.now ?? (() => new Date());
  const mem = new Map<string, { n: number; terms: Set<string>; expires: number }>();

  async function incr(key: string, ttlS: number, term?: string) {
    if (deps.redis) {
      const n = await deps.redis.incr(key);
      if (n === 1) await deps.redis.expire(key, ttlS);
      let terms = 0;
      if (term) {
        const setKey = `${key}:terms`;
        await deps.redis.sadd(setKey, term);
        await deps.redis.expire(setKey, ttlS);
        terms = await deps.redis.scard(setKey);
      }
      return { n, terms };
    }
    const t = now().getTime();
    let e = mem.get(key);
    if (!e || e.expires < t) e = { n: 0, terms: new Set(), expires: t + ttlS * 1000 };
    e.n += 1;
    if (term) e.terms.add(term);
    mem.set(key, e);
    return { n: e.n, terms: e.terms.size };
  }

  return {
    async check(userId: string, accountCreatedAt: Date, term: string) {
      const t = now();
      const minute = await incr(
        `contractors:search:m:${userId}:${Math.floor(t.getTime() / 60_000)}`,
        120,
      );
      const day = await incr(
        `contractors:search:d:${userId}:${t.toISOString().slice(0, 10)}`,
        172_800,
        term.toLowerCase(),
      );
      const isNew = t.getTime() - accountCreatedAt.getTime() < NEW_ACCOUNT_MS;
      const dayCap = isNew ? SEARCH_PER_DAY_NEW_ACCOUNT : SEARCH_PER_DAY;
      if (day.terms >= SWEEP_ALERT_TERMS && day.terms % SWEEP_ALERT_TERMS === 0)
        deps.logger.warn(
          { userId, distinctTerms: day.terms, searches: day.n },
          'contractor company search sweep',
        );
      if (minute.n > SEARCH_PER_MINUTE || day.n > dayCap)
        throw new AppError('rate_limited', 'Too many searches. Try again later.');
    },
  };
}
