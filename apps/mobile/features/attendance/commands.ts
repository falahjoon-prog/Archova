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
