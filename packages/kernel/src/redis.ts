import { Redis } from 'ioredis';

export type RedisClient = Redis;

export function createRedis(url: string): Redis {
  return new Redis(url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableAutoPipelining: true,
  });
}

/** Tenant-scoped Redis key (backend 02 §2 "Other stores"): `t:{orgId}:…`. Use for every tenant key. */
export function tenantKey(orgId: string, ...parts: string[]): string {
  return ['t', orgId, ...parts].join(':');
}

/** Global-layer key (identity sessions, revocation). */
export function globalKey(...parts: string[]): string {
  return ['g', ...parts].join(':');
}
