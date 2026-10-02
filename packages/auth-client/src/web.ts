import type { Middleware } from '@archova/api-client';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Web adapter (ADR-0004 §5): the session is the `__Host-sid` cookie, which JavaScript never sees.
 * The CSRF token comes from the sign-in / GET /v1/auth/session response and is echoed on unsafe requests.
 */
export function createWebSession() {
  let csrfToken: string | null = null;
  const middleware: Middleware = {
    async onRequest({ request }) {
      if (UNSAFE.has(request.method) && csrfToken) request.headers.set('X-CSRF-Token', csrfToken);
      return request;
    },
    async onResponse({ response }) {
      if (response.headers.get('content-type')?.includes('json') && response.ok) {
        const body = (await response
          .clone()
          .json()
          .catch(() => null)) as { csrfToken?: unknown } | null;
        if (body && typeof body.csrfToken === 'string') csrfToken = body.csrfToken;
      }
      return response;
    },
  };
  return {
    middleware,
    setCsrfToken: (token: string | null) => void (csrfToken = token),
    hasCsrfToken: () => csrfToken !== null,
  };
}
