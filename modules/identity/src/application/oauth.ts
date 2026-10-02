import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, type Database, type Principal, type Tx } from '@archova/kernel';
import {
  oauthClients,
  oauthCodes,
  refreshTokens,
  sessions as sessionsTable,
} from '../infra/tables';
import { ACCESS_TOKEN_TTL_S, AUTH_CODE_TTL_MS, REFRESH_TOKEN_TTL_MS } from '../domain/policy';
import { newToken, sha256, verifyPkce } from './crypto';
import type { SessionService } from './sessions';
import type { TokenSigner } from './tokens';

export interface AuthorizeInput {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: 'S256';
  state: string;
}

export interface TokenInput {
  grant_type: 'authorization_code' | 'refresh_token';
  client_id: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
}

const invalidGrant = (msg = 'The grant is invalid, expired or already used.') =>
  new AppError('oauth.invalid_grant', msg);

/**
 * OAuth 2.1 authorisation code + PKCE for first-party mobile clients (ADR-0004 §2, security-licensing/01).
 * Refresh tokens rotate on every use; reusing an old one revokes the whole family and its session.
 */
export function createOAuthService(
  database: Database,
  sessions: SessionService,
  signer: TokenSigner,
) {
  async function getClient(clientId: string) {
    const [c] = await database.withGlobalTx('identity', (tx) =>
      tx.select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1),
    );
    return c ?? null;
  }

  /** Called with the user's web session. Returns the redirect URL carrying the code. */
  async function authorize(principal: Principal, input: AuthorizeInput): Promise<string> {
    const client = await getClient(input.client_id);
    if (!client) throw new AppError('oauth.invalid_client', 'Unknown client.');
    // Exact match only; never redirect to an unregistered URI.
    if (!client.redirectUris.includes(input.redirect_uri)) {
      throw new AppError(
        'oauth.invalid_request',
        'redirect_uri is not registered for this client.',
      );
    }
    if (!client.firstParty)
      throw new AppError(
        'oauth.invalid_client',
        'Third-party apps need a consent screen (phase 2).',
      );
    const code = newToken();
    await database.withGlobalTx('identity', (tx) =>
      tx.insert(oauthCodes).values({
        codeHash: sha256(code),
        clientId: client.clientId,
        userId: principal.userId,
        redirectUri: input.redirect_uri,
        codeChallenge: input.code_challenge,
        authMethod: principal.authMethod,
        authTime: principal.authTime,
        expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
      }),
    );
    const url = new URL(input.redirect_uri);
    url.searchParams.set('code', code);
    url.searchParams.set('state', input.state);
    return url.toString();
  }

  async function issueRefresh(tx: Tx, sessionId: string, familyId: string) {
    const refresh = newToken();
    await tx.insert(refreshTokens).values({
      id: uuidv7(),
      sessionId,
      tokenHash: sha256(refresh),
      familyId,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    });
    return refresh;
  }

  async function exchangeCode(
    input: TokenInput,
    meta: { ip: string | null; userAgent: string | null },
  ) {
    if (!input.code || !input.code_verifier || !input.redirect_uri) {
      throw new AppError(
        'oauth.invalid_request',
        'code, code_verifier and redirect_uri are required.',
      );
    }
    const code = input.code;
    // Burn the code first (its own transaction), so a failed PKCE attempt can't be retried.
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .update(oauthCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(oauthCodes.codeHash, sha256(code)), isNull(oauthCodes.usedAt)))
        .returning(),
    );
    if (!row || row.expiresAt < new Date()) throw invalidGrant();
    if (row.clientId !== input.client_id || row.redirectUri !== input.redirect_uri)
      throw invalidGrant();
    if (!verifyPkce(input.code_verifier, row.codeChallenge))
      throw invalidGrant('PKCE verification failed.');
    const result = await database.withGlobalTx('identity', async (tx) => {
      const client = /android/i.test(meta.userAgent ?? '') ? 'android' : 'ios';
      const session = await sessions.create(tx, {
        userId: row.userId,
        client,
        authMethod: row.authMethod,
        authTime: row.authTime,
        ip: meta.ip,
        userAgent: meta.userAgent,
        withCookieToken: false,
      });
      const refresh = await issueRefresh(tx, session.sessionId, uuidv7());
      return { userId: row.userId, sessionId: session.sessionId, client, refresh } as const;
    });
    const access = await signer.issue({
      userId: result.userId,
      sessionId: result.sessionId,
      client: result.client,
    });
    return {
      access_token: access,
      token_type: 'Bearer' as const,
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: result.refresh,
    };
  }

  async function rotateRefresh(input: TokenInput) {
    if (!input.refresh_token)
      throw new AppError('oauth.invalid_request', 'refresh_token is required.');
    const presented = input.refresh_token;
    const outcome = await database.withGlobalTx('identity', async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(presented)))
        .limit(1);
      if (!row) return { kind: 'invalid' as const };
      if (row.usedAt) return { kind: 'reuse' as const, sessionId: row.sessionId };
      if (row.expiresAt < new Date()) return { kind: 'invalid' as const };
      const [session] = await tx
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, row.sessionId))
        .limit(1);
      if (!session || session.revokedAt || session.absoluteExpiresAt < new Date())
        return { kind: 'invalid' as const };
      await tx
        .update(refreshTokens)
        .set({ usedAt: new Date() })
        .where(eq(refreshTokens.id, row.id));
      const refresh = await issueRefresh(tx, row.sessionId, row.familyId);
      return { kind: 'ok' as const, refresh, session };
    });
    if (outcome.kind === 'reuse') {
      // Reuse detection: someone holds an old token. Kill the session (and so every token in the family).
      await sessions.revoke(outcome.sessionId);
      throw invalidGrant();
    }
    if (outcome.kind === 'invalid') throw invalidGrant();
    const access = await signer.issue({
      userId: outcome.session.userId,
      sessionId: outcome.session.id,
      client: outcome.session.client,
    });
    return {
      access_token: access,
      token_type: 'Bearer' as const,
      expires_in: ACCESS_TOKEN_TTL_S,
      refresh_token: outcome.refresh,
    };
  }

  async function token(input: TokenInput, meta: { ip: string | null; userAgent: string | null }) {
    const client = await getClient(input.client_id);
    if (!client) throw new AppError('oauth.invalid_client', 'Unknown client.');
    return input.grant_type === 'authorization_code'
      ? exchangeCode(input, meta)
      : rotateRefresh(input);
  }

  async function revoke(tokenValue: string, clientId: string) {
    const client = await getClient(clientId);
    if (!client) return;
    const [row] = await database.withGlobalTx('identity', (tx) =>
      tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(tokenValue)))
        .limit(1),
    );
    if (row) await sessions.revoke(row.sessionId);
  }

  /** Bearer authentication: signature, expiry, then the `sid` revocation check on every request. */
  async function authenticateBearer(tokenValue: string): Promise<Principal | null> {
    const claims = await signer.verify(tokenValue);
    if (!claims) return null;
    if (await sessions.isRevoked(claims.sessionId)) return null;
    return {
      userId: claims.userId,
      sessionId: claims.sessionId,
      client: claims.client,
      authMethod: 'oauth',
      authTime: claims.authTime,
    };
  }

  return { authorize, token, revoke, authenticateBearer, jwks: () => signer.jwks() };
}

export type OAuthService = ReturnType<typeof createOAuthService>;
