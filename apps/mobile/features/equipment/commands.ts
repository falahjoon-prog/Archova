// Plant and equipment on the phone: the fleet and where it is allocated on this project. Read-only, online.
import { unwrap, type ApiClient } from '@archova/api-client';

export async function listAssets(api: ApiClient, orgId: string) {
  return unwrap(await api.GET('/v1/orgs/{orgId}/plant/assets', { params: { path: { orgId } } }))
    .data;
}

export async function listProjectAllocations(
  api: ApiClient,
  orgId: string,
  projectId: string,
  from: string,
) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/plant/allocations', {
      params: { path: { orgId }, query: { projectId, from } },
    }),
  ).data;
}
