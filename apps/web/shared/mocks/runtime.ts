// Runtime for the phase 1 preview data sources. Until Ben's endpoints for a module land in @archova/contracts,
// each feature reads and writes an in-memory store through the same async interface its API-backed source will
// have, so screens, hooks and query keys don't change when the mock is swapped out. Data is synthetic
// (project rule: synthetic or public test data until a pilot consents in writing) and lasts until the page reloads.

import { ApiError } from '@archova/api-client';

/** Simulated network latency so loading states are exercised; zero in tests. */
const LATENCY_MS = process.env.NODE_ENV === 'test' ? 0 : 150;

export function delay<T>(value: T, ms = LATENCY_MS): Promise<T> {
  // Return copies so callers can't mutate the store through cached query data.
  const copy = structuredClone(value);
  return ms > 0
    ? new Promise((resolve) => setTimeout(() => resolve(copy), ms))
    : Promise.resolve(copy);
}

let counter = 0;

/** Prefixed id like the API's (`rfi_…`), unique within the page session. */
export function mockId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(3, '0')}`;
}

/** Throws the same typed error the API client would for an RFC 9457 problem. */
export function problem(status: number, code: string, detail: string): never {
  throw new ApiError(status, { type: 'about:blank', title: detail, status, detail, code } as never);
}

/** One store per project, created lazily from a seed function. */
export function projectStores<S>(seed: (projectId: string) => S) {
  const stores = new Map<string, S>();
  return {
    get(projectId: string): S {
      let s = stores.get(projectId);
      if (!s) {
        s = seed(projectId);
        stores.set(projectId, s);
      }
      return s;
    },
    /** Test helper: drop every store so the next read reseeds. */
    reset() {
      stores.clear();
    },
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}
