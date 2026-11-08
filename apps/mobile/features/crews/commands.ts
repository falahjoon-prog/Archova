// Crews on the phone: the roster of shifts with who is offered, accepted or declined. Answering an offer needs a "my worker" lookup and comes with My Time. There is no crew entity yet, a crew is the
// free-text label on a shift, so this lists shifts. Online only.
import { unwrap, type ApiClient } from '@archova/api-client';

export interface CrewTarget {
  orgId: string;
  projectId: string;
}

const path = (t: CrewTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listShifts(
  api: ApiClient,
  t: CrewTarget,
  range: { from: string; to: string },
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/shifts', {
      params: { path: path(t), query: range },
    }),
  ).data;
}
