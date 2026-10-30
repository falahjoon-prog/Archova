import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type Principal, type TenantContext } from '@archova/kernel';
import {
  DEFAULT_TOKEN_LIFETIME_DAYS,
  MAX_TOKEN_LIFETIME_DAYS,
  TOKEN_PREFIX,
  unknownScopes,
} from '../domain/api-scopes';
import { apiTokenEvents, apiTokens, users } from '../infra/tables';
import { sha256 } from './crypto';

export type ApiTokenRow = typeof apiTokens.$inferSelect;

/** `last_used_at` is written at most this often per token, so a busy integration is not a write per request. */
const TOUCH_INTERVAL_MS = 60_000;
const DAY_MS = 86_400_000;
/** Tokens a person may hold in one org at a time. */
const MAX_ACTIVE_PER_USER = 25;

export interface CreateApiTokenInput {
  name: string;
  scopes: string[];
  expiresInDays?: number;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** Tenant context for finding a token before the caller is known: the org from the URL, nobody yet. */
const lookupContext = (orgId: string): TenantContext => ({
  orgId,
  userId: NIL_UUID,
  principalType: 'member',
  orgRole: null,
  entitlements: { plan: '', state: 'active', modules: [], limits: {} },
  requestId: 'api-token-lookup',
});

export function createApiTokenService(database: Database, now: () => Date = () => new Date()) {
  async function create(tenant: TenantContext, input: CreateApiTokenInput, ip: string | null) {
    const { orgId, userId } = tenant;
    const name = input.name.trim();
    if (!name) throw new AppError('validation_failed', 'A token needs a name.');
    const scopes = [...new Set(input.scopes)];
    const bad = unknownScopes(scopes);
    if (!scopes.length || bad.length)
      throw new AppError(
        'api_token.invalid_scope',
        bad.length
          ? `Unknown or unavailable scope: ${bad.join(', ')}.`
          : 'Choose at least one scope.',
      );
    const days = input.expiresInDays ?? DEFAULT_TOKEN_LIFETIME_DAYS;
    if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_LIFETIME_DAYS)
      throw new AppError('validation_failed', `Tokens last 1 to ${MAX_TOKEN_LIFETIME_DAYS} days.`);

    const secret = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const at = now();
    const row = await database.withTenantTx(tenant, async ({ tx }) => {
      const active = await tx
        .select({ id: apiTokens.id })
        .from(apiTokens)
        .where(
          and(
            eq(apiTokens.orgId, orgId),
            eq(apiTokens.userId, userId),
            isNull(apiTokens.revokedAt),
            gt(apiTokens.expiresAt, at),
          ),
        );
      if (active.length >= MAX_ACTIVE_PER_USER)
        throw new AppError(
          'api_token.limit_reached',
          'Revoke an unused token before creating another.',
        );
      const [r] = await tx
        .insert(apiTokens)
        .values({
          id: uuidv7(),
          orgId,
          userId,
          name,
          prefix: secret.slice(0, TOKEN_PREFIX.length + 6),
          tokenHash: sha256(secret),
          scopes,
          expiresAt: new Date(at.getTime() + days * DAY_MS),
          createdAt: at,
        })
        .returning();
      await tx.insert(apiTokenEvents).values({
        id: uuidv7(),
        orgId,
        tokenId: r!.id,
        event: 'created',
        userId,
        ip,
        createdAt: at,
      });
      return r!;
    });
    return { row, secret };
  }

  /** A person's own tokens, or every token in the org for an owner or admin. Newest first. */
  async function list(tenant: TenantContext, all: boolean) {
    const { orgId, userId } = tenant;
    return database.withTenantTx(tenant, ({ tx }) =>
      tx
        .select()
        .from(apiTokens)
        .where(and(eq(apiTokens.orgId, orgId), all ? undefined : eq(apiTokens.userId, userId)))
        .orderBy(desc(apiTokens.createdAt))
        .limit(200),
    );
  }

  /** Revokes a token. Without `any` only the caller's own token can be revoked; an owner or admin passes `any`. */
  async function revoke(tenant: TenantContext, tokenId: string, any: boolean, ip: string | null) {
    const { orgId, userId } = tenant;
    const rows = await database.withTenantTx(tenant, async ({ tx }) => {
      const done = await tx
        .update(apiTokens)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(apiTokens.id, tokenId),
            eq(apiTokens.orgId, orgId),
            any ? undefined : eq(apiTokens.userId, userId),
            isNull(apiTokens.revokedAt),
          ),
        )
        .returning({ id: apiTokens.id });
      if (done.length)
        await tx.insert(apiTokenEvents).values({
          id: uuidv7(),
          orgId,
          tokenId,
          event: 'revoked',
          userId,
          ip,
          createdAt: now(),
        });
      return done;
    });
    if (!rows.length) throw new AppError('api_token.not_found');
  }

  /**
   * Bearer authentication for `pk_live_…` tokens, in the org named by the URL (tokens work in one org). Null for
   * anything unknown, revoked, expired or disabled, and for a request with no org.
   */
  async function authenticate(
    secret: string,
    orgId: string | null,
    ip: string | null,
  ): Promise<Principal | null> {
    if (!orgId) return null;
    const at = now();
    const hash = sha256(secret);
    const row = await database.withTenantTx(lookupContext(orgId), async ({ tx }) => {
      const [r] = await tx
        .select({ token: apiTokens })
        .from(apiTokens)
        .innerJoin(users, eq(users.id, apiTokens.userId))
        .where(and(eq(apiTokens.tokenHash, hash), eq(users.status, 'active')))
        .limit(1);
      if (!r) return null;
      const t = r.token;
      if (t.revokedAt || t.expiresAt <= at) return null;
      if (!t.lastUsedAt)
        await tx.insert(apiTokenEvents).values({
          id: uuidv7(),
          orgId: t.orgId,
          tokenId: t.id,
          event: 'first_used',
          userId: t.userId,
          ip,
          createdAt: at,
        });
      if (!t.lastUsedAt || at.getTime() - t.lastUsedAt.getTime() > TOUCH_INTERVAL_MS)
        await tx
          .update(apiTokens)
          .set({ lastUsedAt: at })
          .where(
            and(
              eq(apiTokens.id, t.id),
              or(
                isNull(apiTokens.lastUsedAt),
                lt(apiTokens.lastUsedAt, new Date(at.getTime() - TOUCH_INTERVAL_MS)),
              ),
            ),
          );
      return t;
    });
    if (!row) return null;
    return {
      userId: row.userId,
      sessionId: row.id,
      client: 'api',
      authMethod: 'api_token',
      authTime: row.createdAt,
      apiToken: { id: row.id, orgId: row.orgId, scopes: row.scopes },
    };
  }

  return { create, list, revoke, authenticate };
}

export type ApiTokenService = ReturnType<typeof createApiTokenService>;
