import { createHash } from 'node:crypto';
import { AppError, globalKey, tenantKey, type RedisClient } from '@archova/kernel';

// Idempotency-Key on POST (api.md §3): stored 24 h per org and principal. A retry with the same key and the
// same request replays the first response; the same key with a different request is rejected.
const TTL_S = 24 * 60 * 60;
const IN_FLIGHT = 'in-flight';

export interface StoredResponse {
  hash: string;
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export function idempotencyStore(redis: RedisClient) {
  const keyFor = (orgId: string | null, userId: string, key: string) =>
    orgId ? tenantKey(orgId, 'idem', userId, key) : globalKey('idem', userId, key);

  return {
    requestHash(method: string, url: string, body: unknown) {
      return createHash('sha256')
        .update(`${method} ${url}\n${JSON.stringify(body ?? null)}`)
        .digest('hex');
    },
    /** Returns a stored response to replay, or null after reserving the key for this request. */
    async begin(
      orgId: string | null,
      userId: string,
      key: string,
      hash: string,
    ): Promise<StoredResponse | null> {
      const k = keyFor(orgId, userId, key);
      const reserved = await redis.set(k, IN_FLIGHT, 'EX', 60, 'NX');
      if (reserved === 'OK') return null;
      const raw = await redis.get(k);
      if (!raw || raw === IN_FLIGHT)
        throw new AppError('conflict', 'A request with this Idempotency-Key is still in progress.');
      const stored = JSON.parse(raw) as StoredResponse;
      if (stored.hash !== hash) {
        throw new AppError(
          'validation_failed',
          'This Idempotency-Key was already used for a different request.',
          [{ path: 'Idempotency-Key', message: 'Reused with a different request' }],
        );
      }
      return stored;
    },
    async finish(
      orgId: string | null,
      userId: string,
      key: string,
      response: StoredResponse | null,
    ) {
      const k = keyFor(orgId, userId, key);
      if (response) await redis.set(k, JSON.stringify(response), 'EX', TTL_S);
      else await redis.del(k);
    },
  };
}

export type IdempotencyStore = ReturnType<typeof idempotencyStore>;
