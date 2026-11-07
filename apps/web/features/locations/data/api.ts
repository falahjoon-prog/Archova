// The project's location tree (platform) against its endpoints. Defects, RFIs, inspections and observations
// point at a row of this tree instead of carrying free text.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ProjectLocation = S['ProjectLocation'];
export type LocationKind = S['LocationKind'];
export type LocationSuggestion = S['LocationSuggestion'];
export type CreateLocation = S['CreateLocationRequest'];
export type UpdateLocation = S['UpdateLocationRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}/locations' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export function createLocationsApi(orgId: string) {
  return {
    async list(projectId: string, includeArchived = false): Promise<ProjectLocation[]> {
      return unwrap(
        await api.GET(P, {
          params: {
            path: { orgId, projectId },
            query: includeArchived ? { includeArchived: 'true' } : {},
          },
        }),
      ).data;
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
          params: { path: { orgId, projectId, locationId }, header: ifMatch(version) },
          body,
        }),
      );
    },
    /** Nova's guess at where a record is, from its words. Rule-based; the person confirms. */
    async suggest(projectId: string, text: string): Promise<LocationSuggestion[]> {
      return unwrap(
        await api.GET(`${P}/suggest`, {
          params: { path: { orgId, projectId }, query: { text } },
        }),
      ).data;
    },
  };
}
