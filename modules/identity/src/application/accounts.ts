import { eq, inArray } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type Principal } from '@archova/kernel';
import { credentials, users } from '../infra/tables';
import { passwordProblems } from '../domain/policy';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords';
import type { SessionService } from './sessions';

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string | null;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

const toRecord = (u: typeof users.$inferSelect): UserRecord => ({
  id: u.id,
  email: u.email,
  name: u.name,
  locale: u.locale,
  timezone: u.timezone,
});

export function createAccountService(database: Database, sessions: SessionService) {
  async function signup(
    input: { email: string; password: string; name: string },
    meta: RequestMeta,
  ) {
    const email = input.email.trim();
    const problems = passwordProblems(input.password, email);
    if (problems.length) {
      throw new AppError(
        'auth.weak_password',
        problems.join(' '),
        problems.map((message) => ({ path: 'password', message })),
      );
    }
    const secretHash = await hashPassword(input.password);
    try {
      return await database.withGlobalTx('identity', async (tx) => {
        const userId = uuidv7();
        const [user] = await tx
          .insert(users)
          .values({
            id: userId,
            email,
            name: input.name.trim(),
            locale: 'en-AU',
            status: 'active',
            lastLoginAt: new Date(),
          })
          .returning();
        await tx.insert(credentials).values({ id: uuidv7(), userId, type: 'password', secretHash });
        const session = await sessions.create(tx, {
          userId,
          client: 'web',
          authMethod: 'password',
          ip: meta.ip,
          userAgent: meta.userAgent,
          withCookieToken: true,
        });
        return { user: toRecord(user!), session };
      });
    } catch (e) {
      if (
        (e as { cause?: { code?: string }; code?: string }).cause?.code === '23505' ||
        (e as { code?: string }).code === '23505'
      ) {
        throw new AppError(
          'auth.email_taken',
          'An account with this email already exists. Sign in instead.',
        );
      }
      throw e;
    }
  }

  async function login(input: { email: string; password: string }, meta: RequestMeta) {
    const found = await database.withGlobalTx('identity', async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.email, input.email.trim())).limit(1);
      if (!u) return null;
      const [c] = await tx.select().from(credentials).where(eq(credentials.userId, u.id));
      return { user: u, credential: c?.type === 'password' ? c : null };
    });
    const stored = found?.credential?.secretHash ?? (await dummyPasswordHash());
    const ok = await verifyPassword(stored, input.password);
    if (!found || !found.credential || !ok || found.user.status !== 'active') {
      throw new AppError('auth.invalid_credentials', 'Email or password is incorrect.');
    }
    const session = await database.withGlobalTx('identity', async (tx) => {
      await tx.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, found.user.id));
      await tx
        .update(credentials)
        .set({ lastUsedAt: new Date() })
        .where(eq(credentials.id, found.credential!.id));
      return sessions.create(tx, {
        userId: found.user.id,
        client: 'web',
        authMethod: 'password',
        ip: meta.ip,
        userAgent: meta.userAgent,
        withCookieToken: true,
      });
    });
    return { user: toRecord(found.user), session };
  }

  async function getUser(userId: string): Promise<UserRecord | null> {
    const [u] = await database.withGlobalTx('identity', (tx) =>
      tx.select().from(users).where(eq(users.id, userId)).limit(1),
    );
    return u ? toRecord(u) : null;
  }

  async function getUsers(userIds: readonly string[]): Promise<Map<string, UserRecord>> {
    if (userIds.length === 0) return new Map();
    const rows = await database.withGlobalTx('identity', (tx) =>
      tx
        .select()
        .from(users)
        .where(inArray(users.id, [...new Set(userIds)])),
    );
    return new Map(rows.map((u) => [u.id, toRecord(u)]));
  }

  async function findUserByEmail(email: string): Promise<UserRecord | null> {
    const [u] = await database.withGlobalTx('identity', (tx) =>
      tx.select().from(users).where(eq(users.email, email.trim())).limit(1),
    );
    return u && u.status === 'active' ? toRecord(u) : null;
  }

  return { signup, login, getUser, getUsers, findUserByEmail };
}

export type AccountService = ReturnType<typeof createAccountService>;
export type { Principal };
