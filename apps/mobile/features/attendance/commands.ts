// Online gate sign-in and sign-out (workforce `signInSelf` / `signOutSelf`). Offline queueing (ATT-AC9) is later.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface GateTarget {
  orgId: string;
  projectId: string;
}

/** `idempotencyKey` is made once per scan, so a retry after a dropped reply cannot sign in twice. */
export async function signInAtGate(
  api: ApiClient,
  t: GateTarget,
  input: { gateCode: string; idempotencyKey: string; clientAt: string },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/attendance/sign-in', {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
      body: { gateCode: input.gateCode, clientAt: input.clientAt },
    }),
  );
}

export async function signOutOfSite(
  api: ApiClient,
  t: GateTarget,
  input: { idempotencyKey: string; clientAt: string },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/attendance/sign-out', {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
      body: { clientAt: input.clientAt },
    }),
  );
}

const rollCallPath = '/v1/orgs/{orgId}/projects/{projectId}/attendance/roll-calls' as const;

export async function startRollCall(
  api: ApiClient,
  t: GateTarget,
  input: { reason: string; idempotencyKey: string },
) {
  return unwrap(
    await api.POST(rollCallPath, {
      params: {
        path: { orgId: t.orgId, projectId: t.projectId },
        header: { 'Idempotency-Key': input.idempotencyKey },
      },
      body: { reason: input.reason },
    }),
  );
}

export async function markRollCall(
  api: ApiClient,
  t: GateTarget,
  rollCallId: string,
  mark: { workerId: string; status: 'accounted_for' | 'missing' | 'not_on_site' },
) {
  return unwrap(
    await api.POST(`${rollCallPath}/{rollCallId}/marks`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, rollCallId } },
      body: mark,
    }),
  );
}

export async function endRollCall(api: ApiClient, t: GateTarget, rollCallId: string) {
  return unwrap(
    await api.POST(`${rollCallPath}/{rollCallId}/end`, {
      params: { path: { orgId: t.orgId, projectId: t.projectId, rollCallId } },
    }),
  );
}
