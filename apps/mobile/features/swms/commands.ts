// The SWMS register on the phone: read a statement, acknowledge it before work starts, and (for reviewers) move it
// through review. Who may do what is decided by the server; the phone shows the actions it offers.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface SwmsTarget {
  orgId: string;
  projectId: string;
}

const path = (t: SwmsTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listSwms(
  api: ApiClient,
  t: SwmsTarget,
  opts: { status?: string; expired?: boolean } = {},
) {
  const query: Record<string, unknown> = { limit: 50 };
  if (opts.status) query.status = opts.status;
  if (opts.expired) query.expired = 'true';
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/swms', {
      params: { path: path(t), query: query as never },
    }),
  ).data;
}

export async function getSwms(api: ApiClient, t: SwmsTarget, swmsId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/swms/{swmsId}', {
      params: { path: { ...path(t), swmsId } },
    }),
  );
}

/** `idempotencyKey` is made once per tap, so a retry after a dropped reply cannot acknowledge twice. */
export async function acknowledgeSwms(
  api: ApiClient,
  t: SwmsTarget,
  a: { swmsId: string; workerName: string; idempotencyKey: string },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/swms/{swmsId}/acknowledge', {
      params: {
        path: { ...path(t), swmsId: a.swmsId },
        header: { 'Idempotency-Key': a.idempotencyKey },
      },
      body: { workerName: a.workerName.trim(), language: 'en' },
    }),
  );
}

export type SwmsAction = 'markReviewed' | 'accept' | 'reject' | 'reopen';

export async function transitionSwms(
  api: ApiClient,
  t: SwmsTarget,
  swms: { id: string; version: number },
  a: { action: SwmsAction; reason?: string },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/swms/{swmsId}/transition', {
      params: {
        path: { ...path(t), swmsId: swms.id },
        header: { 'If-Match': `"${swms.version}"` },
      },
      body: {
        action: a.action,
        ...(a.reason?.trim() ? { reason: a.reason.trim() } : {}),
        ...(a.action === 'accept' ? { confirmedUnderstandable: true } : {}),
      },
    }),
  );
}
