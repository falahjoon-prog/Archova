// RFIs on the phone: the register, one RFI with its responses, and an answer from the person the ball is with.
// Who may answer is decided by the server; the phone only offers the form.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface RfiTarget {
  orgId: string;
  projectId: string;
}

const path = (t: RfiTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listRfis(
  api: ApiClient,
  t: RfiTarget,
  opts: { q?: string; mineUserId?: string; overdue?: boolean } = {},
) {
  const query: Record<string, unknown> = { limit: 50 };
  if (opts.q?.trim()) query.q = opts.q.trim();
  if (opts.mineUserId) query.ballInCourt = opts.mineUserId;
  if (opts.overdue) query.overdue = 'true';
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/rfis', {
      params: { path: path(t), query: query as never },
    }),
  ).data;
}

export async function getRfi(api: ApiClient, t: RfiTarget, rfiId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}', {
      params: { path: { ...path(t), rfiId } },
    }),
  );
}

/** `idempotencyKey` is made once per answer so a retry after a dropped reply cannot answer twice. */
export async function respondToRfi(
  api: ApiClient,
  t: RfiTarget,
  a: { rfiId: string; body: string; idempotencyKey: string },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/rfis/{rfiId}/responses', {
      params: {
        path: { ...path(t), rfiId: a.rfiId },
        header: { 'Idempotency-Key': a.idempotencyKey },
      },
      body: { body: a.body.trim() },
    }),
  );
}
