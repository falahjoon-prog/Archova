// Permits on the phone: see what is expiring and start a renewal, online. Adding permits and recording the renewed
// date stay on the web. The server checks the caller's permission for every call.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface PermitTarget {
  orgId: string;
  projectId: string;
}

const path = (t: PermitTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listPermits(api: ApiClient, t: PermitTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/permits', {
      params: { path: path(t), query: { limit: 100 } },
    }),
  ).data;
}

export async function listPermitFlags(api: ApiClient, t: PermitTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/permits/flags', {
      params: { path: path(t) },
    }),
  ).data;
}

export async function getPermit(api: ApiClient, t: PermitTarget, permitId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/permits/{permitId}', {
      params: { path: { ...path(t), permitId } },
    }),
  );
}

/** Starts a renewal against the version that was read, so a change made elsewhere is refused, not overwritten. */
export async function startRenewal(
  api: ApiClient,
  t: PermitTarget,
  permit: { id: string; version: number },
) {
  return unwrap(
    await api.POST('/v1/orgs/{orgId}/projects/{projectId}/permits/{permitId}/transition', {
      params: {
        path: { ...path(t), permitId: permit.id },
        header: { 'If-Match': `"${permit.version}"` },
      },
      body: { action: 'startRenewal' },
    }),
  );
}
