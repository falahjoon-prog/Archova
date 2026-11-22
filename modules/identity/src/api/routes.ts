import { decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  requirePrincipal,
  requireTenant,
  type CookieSpec,
} from '@archova/kernel';
import { CSRF_COOKIE, SESSION_ABSOLUTE_MS, SESSION_COOKIE } from '../domain/policy';
import { newToken } from '../application/crypto';
import { APP_SCOPES, TOKEN_SCOPES } from '../domain/api-scopes';
import type { PartnerAppService } from '../application/partner-apps';
import type { ApiTokenService } from '../application/api-tokens';
import type { AccountService } from '../application/accounts';
import {
  EXTERNAL_FLOW_COOKIE,
  EXTERNAL_FLOW_MAX_AGE_S,
  ExternalSignInError,
  decodeFlow,
  encodeFlow,
  type ExternalProvider,
  type ExternalSignInService,
} from '../application/external-signin';
import type { OAuthService } from '../application/oauth';
import type { SessionService } from '../application/sessions';
import { toApiTokenDto, toAppInstallDto, toOauthAppDto, toUserDto } from './mappers';

export interface IdentityRouteDeps {
  accounts: AccountService;
  sessions: SessionService;
  oauth: OAuthService;
  external: ExternalSignInService;
  apiTokens: ApiTokenService;
  partnerApps: PartnerAppService;
  /** Web sign-in page; unauthenticated /oauth/authorize requests are sent here with `next`. */
  webSignInUrl: string;
}

const sessionCookies = (token: string, csrf: string): CookieSpec[] => [
  { name: SESSION_COOKIE, value: token, httpOnly: true, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 },
  { name: CSRF_COOKIE, value: csrf, httpOnly: true, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 },
];

/** How recent a sign-in `prompt=login` accepts as "just now". */
const FRESH_LOGIN_MS = 5 * 60_000;

/** How recently the person must have signed in to create a token. */
const STEP_UP_MS = 15 * 60_000;

export function identityRoutes({
  accounts,
  sessions,
  oauth,
  external,
  apiTokens,
  partnerApps,
  webSignInUrl,
}: IdentityRouteDeps) {
  const externalStart = async (provider: ExternalProvider, next: string | undefined) => {
    if (!external.enabled(provider)) {
      const url = new URL(webSignInUrl);
      url.searchParams.set('error', `${provider}_unavailable`);
      return { status: 302, redirect: url.toString() };
    }
    const { redirect, flow } = external.begin(provider, next);
    return {
      status: 302,
      redirect,
      setCookies: [
        {
          name: EXTERNAL_FLOW_COOKIE,
          value: encodeFlow(flow),
          httpOnly: true,
          maxAgeSeconds: EXTERNAL_FLOW_MAX_AGE_S,
        },
      ],
    };
  };

  const externalCallback = async (
    provider: ExternalProvider,
    {
      query,
      cookies,
      ip,
      userAgent,
    }: {
      query: { code?: string; state?: string; error?: string };
      cookies: Record<string, string | undefined>;
      ip: string | null;
      userAgent: string | null;
    },
  ) => {
    const fail = (reason: string) => {
      const url = new URL(webSignInUrl);
      url.searchParams.set('error', `${provider}_${reason}`);
      return {
        status: 302,
        redirect: url.toString(),
        clearCookies: [EXTERNAL_FLOW_COOKIE],
        headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      };
    };
    const origin = external.origin(provider);
    if (!external.enabled(provider) || !origin) return fail('unavailable');
    // The provider sends `error=access_denied` when the person presses Cancel.
    if (query.error) return fail('cancelled');
    if (!query.code || !query.state) return fail('failed');
    try {
      const { session, next } = await external.complete(
        provider,
        {
          code: query.code,
          state: query.state,
          flow: decodeFlow(cookies[EXTERNAL_FLOW_COOKIE]),
        },
        { ip, userAgent },
      );
      return {
        status: 302,
        redirect: new URL(next ?? '/orgs', origin).toString(),
        setCookies: sessionCookies(session.token!, newToken()),
        clearCookies: [EXTERNAL_FLOW_COOKIE],
        headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' },
      };
    } catch (e) {
      // Which emails already have an account is not for the browser to learn: that refusal looks like any failure
      // here, and the reason stays in the security log.
      if (e instanceof ExternalSignInError)
        return fail(e.reason === 'link_requires_sign_in' ? 'failed' : e.reason);
      throw e;
    }
  };

  /** Partner app administration needs a person signed in to the app, recently, and a plan with API access. */
  const appAdmin = (
    input: Parameters<typeof requireTenant>[0] & Parameters<typeof requirePrincipal>[0],
    opts: { web?: boolean } = {},
  ) => {
    const tenant = requireTenant(input);
    const principal = requirePrincipal(input);
    if (principal.apiToken || tenant.principalType !== 'member')
      throw new AppError('app.not_allowed', 'Sign in as a member to manage apps.');
    // Approval is a browser action on the app origin; a bearer token of any kind cannot give it.
    if (opts.web && principal.client !== 'web')
      throw new AppError('app.not_allowed', 'Sign in on the web to approve an app.');
    if (Date.now() - principal.authTime.getTime() > STEP_UP_MS)
      throw new AppError('auth.step_up_required', 'Sign in again to manage apps.');
    if (!tenant.entitlements.modules.includes('api'))
      throw new AppError(
        'entitlement-required',
        'Your plan does not include API access.',
        undefined,
        {
          module: 'api',
        },
      );
    return tenant;
  };
  return defineRoutes({
    getOauthConsent: async (input) => {
      const principal = requirePrincipal(input);
      if (principal.client !== 'web' || principal.apiToken)
        throw new AppError('app.not_allowed', 'Sign in on the web to approve an app.');
      const c = await partnerApps.consentInfo(input.query.client_id, input.query.redirect_uri);
      return {
        status: 200,
        body: { ...c, ownerOrgId: encodeId('org', c.ownerOrgId) },
        headers: { 'cache-control': 'no-store' },
      };
    },
    listOauthApps: async (input) => {
      const tenant = requireTenant(input);
      const rows = await partnerApps.listApps(tenant);
      return {
        status: 200,
        body: { data: rows.map(toOauthAppDto), availableScopes: [...APP_SCOPES] },
      };
    },
    createOauthApp: async (input) => {
      const tenant = appAdmin(input);
      const r = await partnerApps.createApp(tenant, input.body, input.ip);
      return {
        status: 201,
        body: {
          clientId: r.clientId,
          name: r.name,
          description: input.body.description?.trim() || null,
          redirectUris: r.redirectUris,
          scopes: r.scopes,
          disabled: false,
          clientSecret: r.secret,
        },
        headers: { 'cache-control': 'no-store' },
      };
    },
    rotateOauthAppSecret: async (input) => {
      const tenant = appAdmin(input);
      const r = await partnerApps.rotateSecret(tenant, input.params.clientId, input.ip);
      return {
        status: 200,
        body: { clientId: r.clientId, clientSecret: r.secret },
        headers: { 'cache-control': 'no-store' },
      };
    },
    listAppInstalls: async (input) => {
      const tenant = requireTenant(input);
      const rows = await partnerApps.listInstalls(tenant);
      return { status: 200, body: { data: rows.map(toAppInstallDto) } };
    },
    installApp: async (input) => {
      const tenant = appAdmin(input, { web: true });
      const redirectUrl = await partnerApps.install(tenant, input.body, input.ip);
      return {
        status: 201,
        body: { redirectUrl },
        headers: { 'cache-control': 'no-store' },
      };
    },
    revokeAppInstall: async (input) => {
      const tenant = requireTenant(input);
      if (requirePrincipal(input).apiToken)
        throw new AppError('app.not_allowed', 'Sign in as a member to remove an app.');
      const id = decodeId('appInstall', input.params.appInstallId);
      if (!id) throw new AppError('app.not_found');
      await partnerApps.revokeInstall(tenant, id, input.ip);
      return { status: 204 };
    },
    listApiTokens: async (input) => {
      const tenant = requireTenant(input);
      const admin = tenant.orgRole === 'owner' || tenant.orgRole === 'admin';
      const rows = await apiTokens.list(tenant, admin);
      return {
        status: 200,
        body: { data: rows.map(toApiTokenDto), availableScopes: [...TOKEN_SCOPES] },
      };
    },
    createApiToken: async (input) => {
      const tenant = requireTenant(input);
      // Tokens are made by a person signed in to the app, never by another token.
      if (requirePrincipal(input).apiToken || tenant.principalType !== 'member')
        throw new AppError('api_token.not_allowed', 'Sign in as a member to create a token.');
      // Minting a credential needs a recent sign-in, not just a long-lived session.
      if (Date.now() - requirePrincipal(input).authTime.getTime() > STEP_UP_MS)
        throw new AppError('auth.step_up_required', 'Sign in again to create an API token.');
      if (!tenant.entitlements.modules.includes('api'))
        throw new AppError(
          'entitlement-required',
          'Your plan does not include API access.',
          undefined,
          {
            module: 'api',
          },
        );
      const { row, secret } = await apiTokens.create(tenant, input.body, input.ip);
      return {
        status: 201,
        body: { ...toApiTokenDto(row), token: secret },
        headers: { 'cache-control': 'no-store' },
      };
    },
    revokeApiToken: async (input) => {
      const tenant = requireTenant(input);
      if (requirePrincipal(input).apiToken)
        throw new AppError('api_token.not_allowed', 'Sign in as a member to revoke a token.');
      const tokenId = decodeId('apiToken', input.params.apiTokenId);
      if (!tokenId) throw new AppError('api_token.not_found');
      const admin = tenant.orgRole === 'owner' || tenant.orgRole === 'admin';
      await apiTokens.revoke(tenant, tokenId, admin, input.ip);
      return { status: 204 };
    },
    signup: async ({ body, ip, userAgent }) => {
      const { user, session } = await accounts.signup(body, { ip, userAgent });
      const csrf = newToken();
      return {
        status: 201,
        body: {
          user: toUserDto(user),
          csrfToken: csrf,
          expiresAt: session.absoluteExpiresAt.toISOString(),
        },
        setCookies: sessionCookies(session.token!, csrf),
      };
    },
    login: async ({ body, ip, userAgent }) => {
      const { user, session } = await accounts.login(body, { ip, userAgent });
      const csrf = newToken();
      return {
        status: 200,
        body: {
          user: toUserDto(user),
          csrfToken: csrf,
          expiresAt: session.absoluteExpiresAt.toISOString(),
        },
        setCookies: sessionCookies(session.token!, csrf),
      };
    },
    getAuthProviders: async () => ({
      status: 200,
      body: { google: external.enabled('google'), microsoft: external.enabled('microsoft') },
    }),
    googleSignInStart: ({ query }) => externalStart('google', query.next),
    googleSignInCallback: (input) => externalCallback('google', input),
    microsoftSignInStart: ({ query }) => externalStart('microsoft', query.next),
    microsoftSignInCallback: (input) => externalCallback('microsoft', input),
    logout: async (input) => {
      const principal = requirePrincipal(input);
      await sessions.revoke(principal.sessionId);
      return { status: 204, clearCookies: [SESSION_COOKIE, CSRF_COOKIE] };
    },
    getSession: async (input) => {
      const principal = requirePrincipal(input);
      const user = await accounts.getUser(principal.userId);
      if (!user) throw new AppError('auth.unauthenticated');
      const existing = input.cookies[CSRF_COOKIE];
      const csrf = existing ?? newToken();
      return {
        status: 200,
        body: {
          user: toUserDto(user),
          csrfToken: csrf,
          expiresAt: new Date(principal.authTime.getTime() + SESSION_ABSOLUTE_MS).toISOString(),
        },
        setCookies: existing
          ? []
          : [
              {
                name: CSRF_COOKIE,
                value: csrf,
                httpOnly: true,
                maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000,
              },
            ],
      };
    },
    oauthAuthorize: async ({ principal, query }) => {
      // `prompt=login` (OIDC): the person must have signed in just now, not at some earlier time. A stale session goes
      // to the sign-in page, which makes a new session with a new auth time, and comes back here with `prompt=login`
      // still on the URL, where the fresh sign-in passes.
      const forceLogin = query.prompt === 'login';
      const stale =
        forceLogin && principal && Date.now() - principal.authTime.getTime() > FRESH_LOGIN_MS;
      if (!principal || principal.client !== 'web' || stale) {
        const next = `/v1/oauth/authorize?${new URLSearchParams(query as Record<string, string>).toString()}`;
        const signIn = `${webSignInUrl}?next=${encodeURIComponent(next)}`;
        return { status: 302, redirect: forceLogin ? `${signIn}&prompt=login` : signIn };
      }
      return { status: 302, redirect: await oauth.authorize(principal, query) };
    },
    oauthToken: async ({ body, ip, userAgent }) => ({
      status: 200,
      body: await oauth.token(body, { ip, userAgent }),
      headers: { 'cache-control': 'no-store' },
    }),
    oauthRevoke: async ({ body }) => {
      await oauth.revoke(body.token, body.client_id);
      return { status: 200 };
    },
    getJwks: async () => ({
      status: 200,
      body: oauth.jwks(),
      headers: { 'cache-control': 'public, max-age=300' },
    }),
  });
}
