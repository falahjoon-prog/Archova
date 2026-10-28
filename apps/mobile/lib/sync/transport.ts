// The sync engine's transport over the typed API client (`syncPull`, `syncPush`). A failed request becomes a
// SyncHttpError so the engine can tell retryable failures from ones that need the user.

import { ApiError, unwrap, type ApiClient } from '@archova/api-client';
import {
  formatScopesParam,
  parseRetryAfter,
  SyncHttpError,
  type PushResult,
  type SyncTransport,
} from '@archova/sync-core';

function asSyncError(error: unknown): unknown {
  if (error instanceof ApiError) {
    return new SyncHttpError(error.status, { code: error.code, message: error.message });
  }
  // fetch rejects with a TypeError when there is no network.
  if (error instanceof TypeError) return new SyncHttpError(0, { message: error.message });
  return error;
}

export function createSyncTransport(
  api: ApiClient,
  orgId: string,
  now: () => number = Date.now,
): SyncTransport {
  return {
    async pull(request) {
      try {
        const result = await api.GET('/v1/orgs/{orgId}/sync/pull', {
          params: {
            path: { orgId },
            query: {
              scopes: formatScopesParam(request.scopes),
              since: request.since,
              limit: request.limit,
            },
          },
        });
        const retryAfter = parseRetryAfter(result.response.headers.get('Retry-After'), now());
        try {
          return unwrap(result);
        } catch (error) {
          if (error instanceof ApiError && retryAfter !== undefined) {
            throw new SyncHttpError(error.status, {
              code: error.code,
              retryAfterMs: retryAfter,
              message: error.message,
            });
          }
          throw error;
        }
      } catch (error) {
        throw asSyncError(error);
      }
    },

    async push(request, options) {
      // The drain grant (X38) has no field in the contract yet, so a drain push is refused rather than sent
      // as an ordinary one that would be rejected again.
      if (options.drain) {
        throw new SyncHttpError(501, {
          code: 'not_implemented',
          message: 'The drain grant is not in the sync contract yet',
        });
      }
      try {
        const response = unwrap(
          await api.POST('/v1/orgs/{orgId}/sync/push', {
            params: { path: { orgId } },
            body: {
              mutations: request.mutations.map((m) => ({
                ...m,
                payload: (m.payload ?? {}) as Record<string, unknown>,
              })),
            },
          }),
        );
        return {
          results: response.results.map((r): PushResult =>
            r.status === 'applied'
              ? { mutationId: r.mutationId, status: 'applied', version: r.version ?? 0 }
              : r.status === 'conflict'
                ? {
                    mutationId: r.mutationId,
                    status: 'conflict',
                    ...(r.version === undefined ? {} : { version: r.version }),
                    server: r.server,
                  }
                : r.status === 'rejected'
                  ? {
                      mutationId: r.mutationId,
                      status: 'rejected',
                      problem: r.problem ?? { code: 'rejected' },
                    }
                  : { mutationId: r.mutationId, status: 'pending_review' },
          ),
        };
      } catch (error) {
        throw asSyncError(error);
      }
    },
  };
}
