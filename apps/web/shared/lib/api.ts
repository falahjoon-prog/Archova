import { createApiClient } from '@archova/api-client';
import { createWebSession } from '@archova/auth-client';
import { createQueries } from '@archova/query';

/**
 * The browser's API client (frontend 04 §2-3). Same-origin (`baseUrl: ''`): in deployed environments CloudFront
 * routes `/v1/*` to apps/api; locally `next dev` rewrites it. The `__Host-sid` cookie rides along automatically
 * and the web session middleware echoes the CSRF token on unsafe requests.
 */
export const webSession = createWebSession();

export const api = createApiClient({
  baseUrl: '',
  credentials: 'same-origin',
  middleware: [webSession.middleware],
  headers: { 'X-Client': 'web@0.0.0' },
});

/** Query options shared with mobile (`@archova/query`). */
export const queries = createQueries(api);

let pendingSession: Promise<unknown> | null = null;

/**
 * Makes sure the CSRF token has been captured before an unsafe request. The session bootstrap normally does this on
 * app load; this covers a mutation fired before that first response arrives. The response body is read by the
 * web session middleware, so there is nothing to do with the result here.
 */
export async function ensureCsrfToken(): Promise<void> {
  if (webSession.hasCsrfToken()) return;
  pendingSession ??= api.GET('/v1/auth/session').finally(() => {
    pendingSession = null;
  });
  await pendingSession;
}
