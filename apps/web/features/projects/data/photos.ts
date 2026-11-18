import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

export type ProjectPhoto = components['schemas']['ProjectPhoto'];

/** The newest photos on a project, from every module that takes site photos. */
export async function fetchProjectPhotos(
  orgId: string,
  projectId: string,
  limit: number,
): Promise<ProjectPhoto[]> {
  const res = unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/photos', {
      params: { path: { orgId, projectId }, query: { limit } },
    }),
  );
  return res.data;
}
