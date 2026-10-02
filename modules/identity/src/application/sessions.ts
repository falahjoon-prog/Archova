import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { globalKey, type KernelServices, type Principal, type Tx } from '@archova/kernel';
import { sessions } from '../infra/tables';
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_TOUCH_INTERVAL_MS,
  isSessionActive,
  nextIdleExpiry,
} from '../domain/policy';
import { newToken, sha256 } from './crypto';

export const REVOCATION_CHANNEL = 'identity:session-revoked';

interface CachedSession {
  sessionId: string;
  userId: string;
  client: Principal['client'];
  authMethod: Principal['authMethod'];
  authTime: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
  lastTouchedAt: string;
}

export interface NewSessionInput {
  userId: string;
  client: Principal['client'];
  authMethod: Principal['authMethod'];
  authTime?: Date;
  ip: string | null;
  userAgent: string | null;
  /** Bearer sessions (mobile) have no cookie token; they are reached through refresh tokens. */
  withCookieToken: boolean;
}

export interface CreatedSession {
  sessionId: string;
  token: string | null;
  absoluteExpiresAt: Date;
}

/**
 * Web sessions: opaque `__Host-sid` token → Redis hot copy, backed by identity.sessions (ADR-0004 §1).
 * Revocation deletes the Redis copy, marks the row, sets a revocation marker for bearer `sid` checks and
 * publishes on the revocation channel so realtime closes sockets.
 */
export function createSessionService({
  database,
  redis,
}: Pick<KernelServices, 'database' | 'redis'>) {
  const cacheKey = (tokenHash: Buffer) => globalKey('sess', tokenHash.toString('hex'));
  const revokedKey = (sessionId: string) => globalKey('revoked', sessionId);

  async function create(tx: Tx, input: NewSessionInput): Promise<CreatedSession> {
    const now = new Date();
    const sessionId = uuidv7();
    const token = input.withCookieToken ? newToken() : null;
    const absoluteExpiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_MS);
    await tx.insert(sessions).values({
      id: sessionId,
      tokenHash: token ? sha256(token) : null,
      userId: input.userId,
      client: input.client,
      authMethod: input.authMethod,
      authTime: input.authTime ?? now,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 500) ?? null,
      idleExpiresAt: new Date(now.getTime() + SESSION_IDLE_MS),
      absoluteExpiresAt,
    });
    return { sessionId, token, absoluteExpiresAt };
  }

  function toPrincipal(c: CachedSession): Principal {
    return {
      userId: c.userId,
      sessionId: c.sessionId,
      client: c.client,
      authMethod: c.authMethod,
      authTime: new Date(c.authTime),
    };
  }

  /** Resolves a cookie token to a principal, extending the idle window at most every 5 minutes. */
  async function resolve(token: string): Promise<Principal | null> {
    if (!token || token.length > 100) return null;
    const tokenHash = sha256(token);
    const now = new Date();
    let cached: CachedSession | null = null;
    if (redis) {
      const raw = await redis.get(cacheKey(tokenHash));
      cached = raw ? (JSON.parse(raw) as CachedSession) : null;
    }
    const fromCache = cached !== null;
    if (!cached) {
      const row = await database.withGlobalTx('identity', async (tx) => {
        const [r] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.tokenHash, tokenHash))
          .limit(1);
        return r ?? null;
      });
      if (!row || !isSessionActive(row, now)) return null;
      cached = {
        sessionId: row.id,
        userId: row.userId,
        client: row.client,
        authMethod: row.authMethod,
        authTime: row.authTime.toISOString(),
        idleExpiresAt: row.idleExpiresAt.toISOString(),
        absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
        lastTouchedAt: row.lastSeenAt.toISOString(),
      };
    }
    const times = {
      idleExpiresAt: new Date(cached.idleExpiresAt),
      absoluteExpiresAt: new Date(cached.absoluteExpiresAt),
      revokedAt: null,
    };
    if (!isSessionActive(times, now)) {
      if (redis) await redis.del(cacheKey(tokenHash));
      return null;
    }
    const stale =
      now.getTime() - new Date(cached.lastTouchedAt).getTime() > SESSION_TOUCH_INTERVAL_MS;
    if (stale) {
      const idle = nextIdleExpiry(now, times.absoluteExpiresAt);
      const sessionId = cached.sessionId;
      const updated = await database.withGlobalTx('identity', (tx) =>
        tx
          .update(sessions)
          .set({ lastSeenAt: now, idleExpiresAt: idle })
          .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
          .returning({ id: sessions.id }),
      );
      if (updated.length === 0) return null;
      cached = { ...cached, idleExpiresAt: idle.toISOString(), lastTouchedAt: now.toISOString() };
    }
    if (redis && (stale || !fromCache)) {
      const ttlMs = new Date(cached.idleExpiresAt).getTime() - now.getTime();
      await redis.set(cacheKey(tokenHash), JSON.stringify(cached), 'PX', Math.max(ttlMs, 1000));
    }
    return toPrincipal(cached);
  }

  async function revoke(sessionId: string): Promise<void> {
    const now = new Date();
    const rows = await database.withGlobalTx('identity', (tx) =>
      tx
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
        .returning({
          tokenHash: sessions.tokenHash,
          userId: sessions.userId,
          absoluteExpiresAt: sessions.absoluteExpiresAt,
        }),
    );
    const row = rows[0];
    if (!row || !redis) return;
    const multi = redis.multi();
    if (row.tokenHash) multi.del(cacheKey(row.tokenHash));
    multi.set(
      revokedKey(sessionId),
      '1',
      'PX',
      Math.max(row.absoluteExpiresAt.getTime() - now.getTime(), 1000),
    );
    multi.publish(REVOCATION_CHANNEL, JSON.stringify({ sessionId, userId: row.userId }));
    await multi.exec();
  }

  /** Bearer requests check the `sid` on every call (ADR-0004 §2). */
  async function isRevoked(sessionId: string): Promise<boolean> {
    if (redis) return (await redis.exists(revokedKey(sessionId))) === 1;
    const row = await database.withGlobalTx('identity', async (tx) => {
      const [r] = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
      return r ?? null;
    });
    return !row || !isSessionActive(row, new Date());
  }

  return { create, resolve, revoke, isRevoked };
}

export type SessionService = ReturnType<typeof createSessionService>;
