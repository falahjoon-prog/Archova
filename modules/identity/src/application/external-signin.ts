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

/** "Continue with …" providers. Each speaks OpenID Connect (code flow with PKCE). */
export type ExternalProvider = 'google' | 'microsoft';
export const EXTERNAL_PROVIDERS: readonly ExternalProvider[] = ['google', 'microsoft'];

export interface ExternalProviderConfig {
  clientId: string;
  clientSecret: string;
  /** Where the provider sends the person back: `<web origin>/v1/auth/<provider>/callback`. Must be allowed on the app. */
  redirectUri: string;
  /** Replaceable in tests. */
  fetch?: typeof fetch;
}

export type ExternalProviderConfigs = Partial<
  Record<ExternalProvider, ExternalProviderConfig | null>
>;

interface IdTokenClaims {
  iss?: string;
  aud?: string;
  exp?: number;
  sub?: string;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  /** Microsoft: the tenant the person signed in to. */
  tid?: string;
  /** Microsoft optional claim: the address's domain is owned by the tenant. */
  xms_edov?: boolean | string;
}

interface ProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  /** Is the token from the issuer this provider uses? */
  issuerOk(claims: IdTokenClaims): boolean;
  /**
   * Does the provider vouch that the person owns the address? An address it does not vouch for is never used to
   * find or take over an existing account (Microsoft's `email` claim can be set by a tenant admin to any value).
   */
  emailVouched(claims: IdTokenClaims): boolean;
}

const truthy = (v: boolean | string | undefined) => v === true || v === 'true';

/** The tenant id Microsoft uses for personal accounts (outlook.com, hotmail.com, …), whose address is the sign-in. */
const MICROSOFT_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const SPECS: Record<ExternalProvider, ProviderSpec> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    issuerOk: (c) => c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com',
    emailVouched: (c) => truthy(c.email_verified),
  },
  microsoft: {
    // `common`: work, school and personal accounts. The issuer then names the person's own tenant.
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    issuerOk: (c) =>
      typeof c.tid === 'string' &&
      /^[0-9a-f-]{36}$/i.test(c.tid) &&
      c.iss === `https://login.microsoftonline.com/${c.tid}/v2.0`,
    emailVouched: (c) => c.tid === MICROSOFT_PERSONAL_TENANT || truthy(c.xms_edov),
  },
};

/** What we keep between the redirect to the provider and the return, in a short-lived cookie on the web origin. */
export interface ExternalFlowState {
  provider: ExternalProvider;
  state: string;
  verifier: string;
  nonce: string;
  next: string | null;
}

export const EXTERNAL_FLOW_COOKIE = '__Host-oidc';
export const EXTERNAL_FLOW_MAX_AGE_S = 600;

export type ExternalFailure =
  | 'cancelled'
  | 'expired'
  | 'unverified_email'
  | 'link_requires_sign_in'
  | 'account_disabled'
  | 'failed';

export class ExternalSignInError extends Error {
  constructor(readonly reason: ExternalFailure) {
    super(`external sign-in failed: ${reason}`);
  }
}

/** Same rule as the web app's `safeNextPath`: only same-origin absolute paths. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || next.length > 2000) return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if ([...next].some((ch) => ch.charCodeAt(0) < 0x20)) return null;
  return next;
}

export const encodeFlow = (f: ExternalFlowState) =>
  Buffer.from(JSON.stringify(f)).toString('base64url');

export function decodeFlow(value: string | undefined): ExternalFlowState | null {
  if (!value) return null;
  try {
    const f = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as ExternalFlowState;
    return EXTERNAL_PROVIDERS.includes(f.provider) &&
      typeof f.state === 'string' &&
      typeof f.verifier === 'string' &&
      typeof f.nonce === 'string'
      ? {
          provider: f.provider,
          state: f.state,
          verifier: f.verifier,
          nonce: f.nonce,
          next: safeNext(f.next),
        }
      : null;
  } catch {
    return null;
  }
}

export function createExternalSignInService(
  database: Database,
  sessions: SessionService,
  configs: ExternalProviderConfigs,
) {
  const configOf = (provider: ExternalProvider) => configs[provider] ?? null;

  /** The URL to send the person to, and the state to remember for their return. */
  function begin(provider: ExternalProvider, next: string | null | undefined) {
    const config = configOf(provider);
    if (!config) throw new ExternalSignInError('failed');
    const flow: ExternalFlowState = {
      provider,
      state: newToken(),
      verifier: newToken(),
      nonce: newToken(),
      next: safeNext(next),
    };
    const url = new URL(SPECS[provider].authorizeUrl);
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

  async function exchange(
    provider: ExternalProvider,
    code: string,
    flow: ExternalFlowState,
  ): Promise<IdTokenClaims> {
    const config = configOf(provider);
    if (!config) throw new ExternalSignInError('failed');
    const spec = SPECS[provider];
    let res: Response;
    try {
      res = await (config.fetch ?? fetch)(spec.tokenUrl, {
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
      throw new ExternalSignInError('failed');
    }
    if (!res.ok) throw new ExternalSignInError('failed');
    let claims: IdTokenClaims;
    try {
      const body = (await res.json()) as { id_token?: string };
      const part = body.id_token?.split('.')[1];
      if (!part) throw new Error('no id_token');
      claims = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as IdTokenClaims;
    } catch {
      throw new ExternalSignInError('failed');
    }
    // The token came straight from the provider's token endpoint over TLS, so OIDC Core §3.1.3.7 lets us skip checking
    // its signature; we still check who issued it, who it is for, that it is fresh and that it answers this request.
    if (!spec.issuerOk(claims)) throw new ExternalSignInError('failed');
    if (claims.aud !== config.clientId) throw new ExternalSignInError('failed');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now())
      throw new ExternalSignInError('expired');
    if (!claims.nonce || !safeEqual(claims.nonce, flow.nonce))
      throw new ExternalSignInError('failed');
    if (!claims.sub || !claims.email) throw new ExternalSignInError('failed');
    return claims;
  }

  /** Completes sign-in: returns the new web session. Creates the account on first use. */
  async function complete(
    provider: ExternalProvider,
    input: { code: string; state: string; flow: ExternalFlowState | null },
    meta: RequestMeta,
  ) {
    const { flow } = input;
    if (!flow || flow.provider !== provider || !safeEqual(flow.state, input.state))
      throw new ExternalSignInError('expired');
    const claims = await exchange(provider, input.code, flow);
    const email = claims.email!.trim();
    const subject = claims.sub!;
    const vouched = SPECS[provider].emailVouched(claims);
    // An address the provider does not vouch for proves nothing about who owns it (Microsoft work tenants can put any
    // address in `email`), so no account is created or joined from it. Work accounts need the `xms_edov` claim.
    if (!vouched) throw new ExternalSignInError('unverified_email');

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
          and(eq(externalIdentities.provider, provider), eq(externalIdentities.subject, subject)),
        )
        .limit(1);
      if (linked) {
        userId = linked.userId;
        const [u] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
        if (!u || u.status !== 'active') throw new ExternalSignInError('account_disabled');
        await tx
          .update(externalIdentities)
          .set({ lastUsedAt: now })
          .where(eq(externalIdentities.id, linked.id));
      } else {
        const [existing] = await tx.select().from(users).where(eq(users.email, email)).limit(1);
        if (existing) {
          if (existing.status !== 'active') throw new ExternalSignInError('account_disabled');
          userId = existing.id;
          // Anything beyond a password (a second factor, a passkey) on a verified account must not be bypassed by an
          // outside sign-in: the person signs in the usual way and links the provider from their account instead.
          const creds = await tx
            .select({ type: credentials.type })
            .from(credentials)
            .where(eq(credentials.userId, userId));
          // Only for an account whose address was proven: on an unverified one a factor may have been added by the
          // squatter, and the takeover below removes it.
          if (existing.emailVerifiedAt && creds.some((c) => c.type !== 'password'))
            throw new ExternalSignInError('link_requires_sign_in');
          if (!existing.emailVerifiedAt) {
            // Sign-up does not verify addresses, so someone else may have registered this one. The provider has just
            // vouched for this person, so everything the squatter could hold goes: credentials, sessions, API tokens.
            const gone = await tx
              .delete(credentials)
              .where(eq(credentials.userId, userId))
              .returning({ id: credentials.id });
            takeover = true;
            unlinkedPassword = gone.length > 0;
            await tx.delete(oauthCodes).where(eq(oauthCodes.userId, userId));
            // Outside identities too: one made earlier by someone else must not outlive the takeover.
            await tx.delete(externalIdentities).where(eq(externalIdentities.userId, userId));
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
          provider,
          subject,
          email,
          ...(typeof claims.tid === 'string' ? { tenantId: claims.tid } : {}),
          lastUsedAt: now,
        });
      }
      await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, userId));
      await recordSecurityEvent(tx, {
        orgId: null,
        action: created ? `auth.signup.${provider}` : 'auth.login.succeeded',
        actorType: 'user',
        actorId: userId,
        targetType: 'account',
        targetId: userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
        client: 'web',
        metadata: { method: provider, ...(unlinkedPassword ? { passwordRemoved: true } : {}) },
      });
      const session = await sessions.create(tx, {
        userId,
        client: 'web',
        authMethod: provider,
        // Not earlier than the cut-off written above, or the new session would count as one the cut-off ended.
        authTime: now,
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
    provider: ExternalProvider,
    input: { code: string; state: string; flow: ExternalFlowState | null },
    meta: RequestMeta,
  ) {
    // Nothing is written for a callback that never began here (no cookie, wrong state): anyone can send those, and the
    // log is append-only. Only failures after the flow was validated are recorded.
    const validated =
      input.flow !== null &&
      input.flow.provider === provider &&
      safeEqual(input.flow.state, input.state);
    try {
      return await complete(provider, input, meta);
    } catch (e) {
      if (!validated) throw e;
      const reason = e instanceof ExternalSignInError ? e.reason : 'error';
      await database
        .withGlobalTx('identity', (tx) =>
          recordSecurityEvent(tx, {
            orgId: null,
            action: 'auth.login.failed',
            actorType: 'anonymous',
            actorId: null,
            targetType: 'account',
            // A constant per provider, so the per-target cap on failed sign-ins applies.
            targetId: provider,
            ip: meta.ip,
            userAgent: meta.userAgent,
            client: 'web',
            metadata: { method: provider, reason },
          }),
        )
        .catch(() => undefined);
      throw e;
    }
  }

  return {
    enabled: (provider: ExternalProvider) => configOf(provider) !== null,
    /** The web origin the person returns to. */
    origin: (provider: ExternalProvider) => {
      const c = configOf(provider);
      return c ? new URL(c.redirectUri).origin : null;
    },
    begin,
    complete: completeLogged,
  };
}

export type ExternalSignInService = ReturnType<typeof createExternalSignInService>;
