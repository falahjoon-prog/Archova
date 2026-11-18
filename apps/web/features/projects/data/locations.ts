import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ProjectLocation = S['ProjectLocation'];
export type CreateLocation = S['CreateProjectLocationRequest'];
export type UpdateLocation = S['UpdateProjectLocationRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/locations' as const;

export function createLocationsApi(orgId: string) {
  return {
    async list(projectId: string): Promise<ProjectLocation[]> {
      return unwrap(await api.GET(P, { params: { path: { orgId, projectId } } })).data;
    },
    async create(projectId: string, body: CreateLocation): Promise<ProjectLocation> {
      return unwrap(await api.POST(P, { params: { path: { orgId, projectId } }, body }));
    },
    async update(
      projectId: string,
      locationId: string,
      version: number,
      body: UpdateLocation,
    ): Promise<ProjectLocation> {
      return unwrap(
        await api.PATCH(`${P}/{locationId}`, {
          params: {
            path: { orgId, projectId, locationId },
            header: { 'If-Match': `"${version}"` },
          },
          body,
        }),
      );
    },
    async remove(projectId: string, locationId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/{locationId}`, {
          params: { path: { orgId, projectId, locationId } },
        }),
      );
    },
  };
}
