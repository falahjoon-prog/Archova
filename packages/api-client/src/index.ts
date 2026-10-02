// Typed HTTP client generated from the OpenAPI contract (ADR-0006). Web and mobile never hand-write fetch calls.
// Platform specifics (CSRF header for web, bearer + refresh for mobile) plug in as middleware from @archova/auth-client.
import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from '@archova/contracts/openapi';
import type { Problem } from '@archova/contracts';

export type { Middleware } from 'openapi-fetch';
export type { paths } from '@archova/contracts/openapi';

export interface ApiClientOptions {
  /** `''` (same-origin) in the browser, `https://api.<domain>` on mobile, the internal address server-side. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** `same-origin` in the browser so the `__Host-sid` cookie is sent; `omit` on mobile. */
  credentials?: RequestCredentials;
  middleware?: Middleware[];
  headers?: Record<string, string>;
}

export function createApiClient(opts: ApiClientOptions) {
  const client = createClient<paths>({
    baseUrl: opts.baseUrl,
    credentials: opts.credentials ?? 'same-origin',
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.headers ? { headers: opts.headers } : {}),
  });
  for (const m of opts.middleware ?? []) client.use(m);
  return client;
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Thrown by `unwrap` for any non-2xx response. `code` is the stable problem code from @archova/contracts. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem | null;
  constructor(status: number, problem: Problem | null) {
    super(problem?.detail ?? problem?.title ?? `Request failed with ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.code = problem?.code ?? 'internal';
    this.problem = problem;
  }
}

/** `const project = unwrap(await api.GET(...))` — returns data or throws ApiError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.response.ok && result.data !== undefined) return result.data;
  if (result.response.ok && result.response.status === 204) return undefined as T;
  const problem = (
    result.error && typeof result.error === 'object' ? result.error : null
  ) as Problem | null;
  throw new ApiError(result.response.status, problem);
}
