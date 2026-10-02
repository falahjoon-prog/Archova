import { ApiError } from '@archova/api-client';

export const NETWORK_ERROR_MESSAGE =
  "We couldn't reach Archova. Check your connection and try again.";
export const UNKNOWN_ERROR_MESSAGE =
  'Something went wrong. Try again, and contact support if it keeps happening.';

export interface ErrorView {
  /** What to show the user: the RFC 9457 `detail` when the API gives one. */
  message: string;
  /** Field-level messages keyed by the problem's `errors[].path` (e.g. `email`, `body.email`). */
  fieldErrors: Record<string, string>;
  /** Shown so support can find the request (frontend 02 §8). */
  traceId: string | null;
  status: number | null;
  code: string | null;
}

/** Maps any thrown value to what the UI shows. Pure, so screens and tests share it. */
export function toErrorView(error: unknown): ErrorView {
  if (error instanceof ApiError) {
    const problem = error.problem;
    const fieldErrors: Record<string, string> = {};
    for (const e of problem?.errors ?? []) {
      const key = e.path.replace(/^\/?(body[./])?/, '').replace(/\//g, '.');
      if (key && !(key in fieldErrors)) fieldErrors[key] = e.message;
    }
    return {
      message: problem?.detail || problem?.title || UNKNOWN_ERROR_MESSAGE,
      fieldErrors,
      traceId: problem?.traceId ?? null,
      status: error.status,
      code: error.code,
    };
  }
  // fetch rejects with a TypeError when the network or the dev proxy target is down.
  if (error instanceof TypeError) {
    return {
      message: NETWORK_ERROR_MESSAGE,
      fieldErrors: {},
      traceId: null,
      status: null,
      code: null,
    };
  }
  return {
    message: UNKNOWN_ERROR_MESSAGE,
    fieldErrors: {},
    traceId: null,
    status: null,
    code: null,
  };
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}
