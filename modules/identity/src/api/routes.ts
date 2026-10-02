import { AppError, defineRoutes, requirePrincipal, type CookieSpec } from '@archova/kernel';
import { CSRF_COOKIE, SESSION_ABSOLUTE_MS, SESSION_COOKIE } from '../domain/policy';
import { newToken } from '../application/crypto';
import type { AccountService } from '../application/accounts';
import type { OAuthService } from '../application/oauth';
import type { SessionService } from '../application/sessions';
import { toUserDto } from './mappers';

export interface IdentityRouteDeps {
  accounts: AccountService;
  sessions: SessionService;
  oauth: OAuthService;
  /** Web sign-in page; unauthenticated /oauth/authorize requests are sent here with `next`. */
  webSignInUrl: string;
}

const sessionCookies = (token: string, csrf: string): CookieSpec[] => [
  { name: SESSION_COOKIE, value: token, httpOnly: true, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 },
  { name: CSRF_COOKIE, value: csrf, httpOnly: true, maxAgeSeconds: SESSION_ABSOLUTE_MS / 1000 },
];

export function identityRoutes({ accounts, sessions, oauth, webSignInUrl }: IdentityRouteDeps) {
  return defineRoutes({
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
      if (!principal || principal.client !== 'web') {
        const next = `/v1/oauth/authorize?${new URLSearchParams(query as Record<string, string>).toString()}`;
        return { status: 302, redirect: `${webSignInUrl}?next=${encodeURIComponent(next)}` };
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
