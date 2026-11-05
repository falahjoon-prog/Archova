// Owner portal on the phone: the client reads published progress, decides approvals and sees the capital plan. Online
// only; builders write on the web. The same endpoints serve both, so what a person may do follows their permissions.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface PortalTarget {
  orgId: string;
  projectId: string;
}

const path = (t: PortalTarget) => ({ orgId: t.orgId, projectId: t.projectId });
const B = '/v1/orgs/{orgId}/projects/{projectId}/owner-portal';

export async function listUpdates(api: ApiClient, t: PortalTarget) {
  return unwrap(await api.GET(`${B}/progress-updates` as const, { params: { path: path(t) } }))
    .data;
}

export async function listApprovals(api: ApiClient, t: PortalTarget) {
  return unwrap(await api.GET(`${B}/approvals` as const, { params: { path: path(t) } })).data;
}

export async function capitalPlan(api: ApiClient, t: PortalTarget) {
  return unwrap(await api.GET(`${B}/capital-plan` as const, { params: { path: path(t) } }));
}

/** A decision is final, so the screen asks the person to confirm before calling this. */
export async function decide(
  api: ApiClient,
  t: PortalTarget,
  approvalId: string,
  decision: 'approved' | 'rejected',
) {
  return unwrap(
    await api.POST(`${B}/approvals/{approvalId}/decision` as const, {
      params: { path: { ...path(t), approvalId } },
      body: { decision },
    }),
  );
}
