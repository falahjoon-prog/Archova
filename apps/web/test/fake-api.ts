import { vi } from 'vitest';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Init = {
  params?: {
    path?: Record<string, string>;
    query?: Record<string, unknown>;
    header?: Record<string, string>;
  };
  body?: unknown;
};
type Handler = (init: Init) => unknown;

/**
 * A stand-in for the generated API client in API-source tests: routes are registered by method and path template,
 * every call is recorded, and responses come back in the client's `{ data, response }` shape for `unwrap`.
 * Use with `vi.mock('@/shared/lib/api', () => fake.module)`.
 */
export function createFakeApi() {
  const routes = new Map<string, Handler>();
  const calls: Array<{ method: Method; path: string; init: Init }> = [];
  const call = (method: Method) =>
    vi.fn(async (path: string, init: Init = {}) => {
      calls.push({ method, path, init });
      const handler = routes.get(`${method} ${path}`);
      if (!handler) {
        return {
          error: { code: 'not_found', status: 404, detail: `No fake for ${method} ${path}` },
          response: new Response(null, { status: 404 }),
        };
      }
      const data = handler(init);
      return data === undefined
        ? { data: undefined, response: new Response(null, { status: 204 }) }
        : { data, response: new Response(null, { status: 200 }) };
    });
  const api = {
    GET: call('GET'),
    POST: call('POST'),
    PATCH: call('PATCH'),
    PUT: call('PUT'),
    DELETE: call('DELETE'),
  };
  return {
    on(method: Method, path: string, handler: Handler) {
      routes.set(`${method} ${path}`, handler);
    },
    calls,
    /** Calls to one route, newest last. */
    callsTo(method: Method, path: string) {
      return calls.filter((c) => c.method === method && c.path === path);
    },
    reset() {
      routes.clear();
      calls.length = 0;
    },
    module: { api, ensureCsrfToken: async () => {}, webSession: {}, queries: {} },
  };
}
