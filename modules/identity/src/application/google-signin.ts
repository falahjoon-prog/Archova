import { and, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { recordSecurityEvent, type Database } from '@archova/kernel';
import {
  credentials,
  externalIdentities,
  oauthCodes,
  refreshTokens,
  sessions as sessionRows,
  users,
} from '../infra/tables';
import { newToken, safeEqual, sha256 } from './crypto';
import type { RequestMeta } from './accounts';
import type { SessionService } from './sessions';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export interface GoogleSignInConfig {
  clientId: string;
  clientSecret: string;
  /** Where Google sends the person back: `<web origin>/v1/auth/google/callback`. Must be allowed on the Google client. */
  redirectUri: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
}

/** What we keep between the redirect to Google and the return, in a short-lived cookie on the web origin. */
export interface GoogleFlowState {
  state: string;
  verifier: string;
  nonce: string;
  next: string | null;
}

export const GOOGLE_FLOW_COOKIE = '__Host-gsi';
export const GOOGLE_FLOW_MAX_AGE_S = 600;

export type GoogleFailure =
  | 'cancelled'
  | 'expired'
  | 'unverified_email'
  | 'link_requires_sign_in'
  | 'account_disabled'
  | 'failed';

export class GoogleSignInError extends Error {
  constructor(readonly reason: GoogleFailure) {
    super(`google sign-in failed: ${reason}`);
  }
}

/** Same rule as the web app's `safeNextPath`: only same-origin absolute paths. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if ([...next].some((ch) => ch.charCodeAt(0) < 0x20)) return null;
  return next;
}

export const encodeFlow = (f: GoogleFlowState) =>
  Buffer.from(JSON.stringify(f)).toString('base64url');

export function decodeFlow(value: string | undefined): GoogleFlowState | null {
  if (!value) return null;
  try {
    const f = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as GoogleFlowState;
    return typeof f.state === 'string' &&
      typeof f.verifier === 'string' &&
      typeof f.nonce === 'string'
      ? { state: f.state, verifier: f.verifier, nonce: f.nonce, next: safeNext(f.next) }
      : null;
  } catch {
    return null;
  }
}

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

export function createGoogleSignInService(
  database: Database,
  sessions: SessionService,
  config: GoogleSignInConfig | null,
) {
  const doFetch = config?.fetch ?? fetch;

  /** The URL to send the person to, and the state to remember for their return. */
  function begin(next: string | null | undefined) {
    if (!config) throw new GoogleSignInError('failed');
    const flow: GoogleFlowState = {
      state: newToken(),
      verifier: newToken(),
      nonce: newToken(),
      next: safeNext(next),
    };
    const url = new URL(AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: sha256(flow.verifier).toString('base64url'),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return { redirect: url.toString(), flow };
  }

  async function exchange(code: string, flow: GoogleFlowState): Promise<IdTokenClaims> {
    if (!config) throw new GoogleSignInError('failed');
    let res: Response;
    try {
      res = await doFetch(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: flow.verifier,
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new GoogleSignInError('failed');
    }
    if (!res.ok) throw new GoogleSignInError('failed');
    let claims: IdTokenClaims;
    try {
      const body = (await res.json()) as { id_token?: string };
      const part = body.id_token?.split('.')[1];
      if (!part) throw new Error('no id_token');
      claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as IdTokenClaims;
    } catch {
      throw new GoogleSignInError('failed');
    }
    // The token came straight from Google's token endpoint over TLS, so OIDC Core §3.1.3.7 lets us skip checking its
    // signature; we still check who issued it, who it is for, that it is fresh and that it answers this request.
    if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com')
      throw new GoogleSignInError('failed');
    if (claims.aud !== config.clientId) throw new GoogleSignInError('failed');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now())
      throw new GoogleSignInError('expired');
    if (!claims.nonce || !safeEqual(claims.nonce, flow.nonce))
      throw new GoogleSignInError('failed');
    if (!claims.sub || !claims.email) throw new GoogleSignInError('failed');
    if (claims.email_verified !== true && claims.email_verified !== 'true')
      throw new GoogleSignInError('unverified_email');
    return claims;
  }

  /** Completes sign-in: returns the new web session. Creates the account on first use. */
  async function complete(
    input: { code: string; state: string; flow: GoogleFlowState | null },
    meta: RequestMeta,
  ) {
    const { flow } = input;
    if (!flow || !safeEqual(flow.state, input.state)) throw new GoogleSignInError('expired');
    const claims = await exchange(input.code, flow);
    const email = claims.email!.trim();
    const subject = claims.sub!;

    const result = await database.withGlobalTx('identity', async (tx) => {
      const now = new Date();
      let userId: string;
      let created = false;
      let unlinkedPassword = false;
      let takeover = false;
      const [linked] = await tx
        .select()
        .from(externalIdentities)
        .where(
          and(eq(externalIdentities.provider, 'google'), eq(externalIdentities.subject, subject)),
        )
        .limit(1);
      if (linked) {
        userId = linked.userId;
        const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!u || u.status !== 'active') throw new GoogleSignInError('account_disabled');
        await tx
          .update(externalIdentities)
          .set({ lastUsedAt: now })
          .where(eq(externalIdentities.id, linked.id));
      } else {
        const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing) {
          if (existing.status !== 'active') throw new GoogleSignInError('account_disabled');
          userId = existing.id;
          // Anything beyond a password (a second factor, a passkey) must not be bypassed by a Google sign-in:
          // the person signs in the usual way and links Google from their account instead.
          const creds = await tx
            .select({ type: credentials.type })
            .from(credentials)
            .where(eq(credentials.userId, userId));
          if (creds.some((c) => c.type !== 'password'))
            throw new GoogleSignInError('link_requires_sign_in');
          if (!existing.emailVerifiedAt) {
            // Sign-up does not verify addresses, so someone else may have registered this one. Google has just proved
            // this person owns it, so everything the squatter could hold goes: credentials, sessions, API tokens.
            const gone = await tx
              .delete(credentials)
              .where(eq(credentials.userId, userId))
              .returning({ id: credentials.id });
            takeover = true;
            unlinkedPassword = gone.length > 0;
            await tx.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
            const mine = tx
              .select({ id: sessionRows.id })
              .from(sessionRows)
              .where(eq(sessionRows.userId, userId));
            await tx
              .update(refreshTokens)
              .set({ usedAt: now })
              .where(and(inArray(refreshTokens.sessionId, mine), isNull(refreshTokens.usedAt)));
            await tx
              .update(users)
              .set({ emailVerifiedAt: now, credentialsResetAt: now })
              .where(eq(users.id, userId));
          }
        } else {
          userId = uuidv7();
          created = true;
          await tx.insert(users).values({
            id: userId,
            email,
            name: (claims.name ?? email.split('@')[0] ?? email).trim().slice(0, 200),
            locale: 'en-AU',
            status: 'active',
            emailVerifiedAt: now,
          });
        }
        await tx.insert(externalIdentities).values({
          id: uuidv7(),
          userId,
          provider: 'google',
          subject,
          email,
          lastUsedAt: now,
        });
      }
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
      await recordSecurityEvent(tx, {
        orgId: null,
        action: created ? 'auth.signup.google' : 'auth.login.succeeded',
        actorType: 'user',
        actorId: userId,
        targetType: 'account',
        targetId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        client: 'web',
        metadata: { method: 'google', ...(unlinkedPassword ? { passwordRemoved: true } : {}) },
      });
      const session = await sessions.create(tx, {
        userId,
        client: 'web',
        authMethod: 'google',
        ip: meta.ip,
        userAgent: meta.userAgent,
        withCookieToken: true,
      });
      return { session, next: flow.next, takeover, userId };
    });
    // Sessions live in Redis too, so they are ended after the commit. The new session is kept.
    if (result.takeover) await sessions.revokeAllForUser(result.userId, result.session.sessionId);
    return { session: result.session, next: result.next };
  }

  /** Same as `complete`, but a refusal is written to the security log (no account is named). */
  async function completeLogged(
    input: { code: string; state: string; flow: GoogleFlowState | null },
    meta: RequestMeta,
  ) {
    try {
      return await complete(input, meta);
    } catch (e) {
      const reason = e instanceof GoogleSignInError ? e.reason : 'error';
      await database
        .withGlobalTx('identity', (tx) =>
          recordSecurityEvent(tx, {
            orgId: null,
            action: 'auth.login.failed',
            actorType: 'anonymous',
            actorId: null,
            targetType: 'account',
            targetId: null,
            ip: meta.ip,
            userAgent: meta.userAgent,
            client: 'web',
            metadata: { method: 'google', reason },
          }),
        )
        .catch(() => undefined);
      throw e;
    }
  }

  return {
    enabled: config !== null,
    /** The web origin the person returns to. */
    origin: config ? new URL(config.redirectUri).origin : null,
    begin,
    complete: completeLogged,
  };
}

export type GoogleSignInService = ReturnType<typeof createGoogleSignInService>;
