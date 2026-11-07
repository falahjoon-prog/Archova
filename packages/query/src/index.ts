// TanStack query key factories and queryOptions per resource (ADR-0006). Hooks stay in each app; keys live here
// so web and mobile invalidate the same way. The objects are plain `{ queryKey, queryFn }` options that
// TanStack Query (react-query on web and mobile) accepts directly.
import { unwrap, type ApiClient } from '@archova/api-client';

export const queryKeys = {
  me: () => ['me'] as const,
  org: (orgId: string) => ['orgs', orgId] as const,
  entitlements: (orgId: string) => ['orgs', orgId, 'entitlements'] as const,
  featureFlags: (orgId: string) => ['orgs', orgId, 'feature-flags'] as const,
  projects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  project: (orgId: string, projectId: string) => ['orgs', orgId, 'projects', projectId] as const,
  projectMembers: (orgId: string, projectId: string) =>
    ['orgs', orgId, 'projects', projectId, 'members'] as const,
  projectPermissions: (orgId: string, projectId: string) =>
    ['orgs', orgId, 'projects', projectId, 'permissions'] as const,
  companies: (orgId: string) => ['orgs', orgId, 'companies'] as const,
  permissionTemplates: (orgId: string) => ['orgs', orgId, 'permission-templates'] as const,

  // Phase 1 project tools. Everything under a tool's root key is invalidated together after a mutation.
  /** Root key of one project tool, e.g. `tool(orgId, projectId, 'rfis')`. */
  tool: (orgId: string, projectId: string, tool: ProjectTool) =>
    ['orgs', orgId, 'projects', projectId, tool] as const,
  toolList: (orgId: string, projectId: string, tool: ProjectTool, filters: object = {}) =>
    ['orgs', orgId, 'projects', projectId, tool, 'list', filters] as const,
  toolItem: (orgId: string, projectId: string, tool: ProjectTool, id: string) =>
    ['orgs', orgId, 'projects', projectId, tool, 'item', id] as const,
  /** Org-scoped drawing revision resources (geometry, markups, pins), per backend 04 §3. */
  drawingRevision: (
    orgId: string,
    revisionId: string,
    part: 'geometry' | 'markups' | 'pins' | 'tiles' | 'detail',
  ) => ['orgs', orgId, 'drawing-revisions', revisionId, part] as const,
  assistantConversation: (orgId: string, conversationId: string) =>
    ['orgs', orgId, 'ai', 'conversations', conversationId] as const,
};

/** Project tools with phase 1 screens; names match the backend modules and mobile features. */
export type ProjectTool =
  | 'documents'
  | 'drawings'
  | 'drawing-sets'
  | 'commitments'
  | 'transmittals'
  | 'rfis'
  | 'submittals'
  | 'correspondence'
  | 'conversations'
  | 'coordination'
  | 'diary'
  | 'key-dates'
  | 'locations'
  | 'photos'
  | 'delays'
  | 'programme'
  | 'defects'
  | 'meetings'
  | 'inductions'
  | 'attendance'
  | 'roster'
  | 'equipment'
  | 'timesheets'
  | 'observations'
  | 'swms'
  | 'incidents'
  | 'inspections'
  | 'late-submissions'
  | 'spec-books'
  | 'owner-portal'
  | 'imports'
  | 'tender-packages'
  | 'takeoff-measurements'
  | 'estimates'
  | 'contracts'
  | 'payment-claims'
  | 'cost-forecast'
  | 'budget';

/** Identity helper that keeps the literal key type, like TanStack's `queryOptions`. */
const queryOptions = <T extends { queryKey: readonly unknown[]; queryFn: () => Promise<unknown> }>(
  o: T & { staleTime?: number },
) => o;

export function createQueries(api: ApiClient) {
  return {
    me: () =>
      queryOptions({
        queryKey: queryKeys.me(),
        queryFn: async () => unwrap(await api.GET('/v1/me')),
      }),
    entitlements: (orgId: string) =>
      queryOptions({
        queryKey: queryKeys.entitlements(orgId),
        queryFn: async () =>
          unwrap(await api.GET('/v1/orgs/{orgId}/entitlements', { params: { path: { orgId } } })),
        staleTime: 5 * 60 * 1000,
      }),
    /** Flags that are on for this org; a flag launches a feature, entitlements still decide what is licensed. */
    featureFlags: (orgId: string) =>
      queryOptions({
        queryKey: queryKeys.featureFlags(orgId),
        queryFn: async () =>
          unwrap(await api.GET('/v1/orgs/{orgId}/feature-flags', { params: { path: { orgId } } })),
        staleTime: 60 * 1000,
      }),
    projects: (orgId: string) =>
      queryOptions({
        queryKey: queryKeys.projects(orgId),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects', {
              params: { path: { orgId }, query: { limit: 200 } },
            }),
          ),
      }),
    project: (orgId: string, projectId: string) =>
      queryOptions({
        queryKey: queryKeys.project(orgId, projectId),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}', {
              params: { path: { orgId, projectId } },
            }),
          ),
      }),
    projectMembers: (orgId: string, projectId: string) =>
      queryOptions({
        queryKey: queryKeys.projectMembers(orgId, projectId),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}/members', {
              params: { path: { orgId, projectId } },
            }),
          ),
      }),
    projectPermissions: (orgId: string, projectId: string) =>
      queryOptions({
        queryKey: queryKeys.projectPermissions(orgId, projectId),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}/permissions', {
              params: { path: { orgId, projectId } },
            }),
          ),
      }),
    /** The drawing register: sheets with their current revision (DOC-AC5). */
    drawings: (orgId: string, projectId: string) =>
      queryOptions({
        queryKey: queryKeys.toolList(orgId, projectId, 'drawings'),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/projects/{projectId}/drawings', {
              params: { path: { orgId, projectId }, query: { limit: 200 } },
            }),
          ),
      }),
    /** One drawing revision with its status, so a viewer can say when a sheet has been superseded. */
    drawingRevision: (orgId: string, projectId: string, revisionId: string) =>
      queryOptions({
        queryKey: [...queryKeys.drawingRevision(orgId, revisionId, 'detail')],
        queryFn: async () =>
          unwrap(
            await api.GET(
              '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}',
              { params: { path: { orgId, projectId, drawingRevisionId: revisionId } } },
            ),
          ),
      }),
    /** Markups on one revision that the caller can see (own, own company's, published). */
    markups: (orgId: string, projectId: string, revisionId: string) =>
      queryOptions({
        queryKey: [...queryKeys.drawingRevision(orgId, revisionId, 'markups')],
        queryFn: async () =>
          unwrap(
            await api.GET(
              '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/markups',
              { params: { path: { orgId, projectId, drawingRevisionId: revisionId } } },
            ),
          ),
      }),
    /** Tile pyramid state for one drawing revision; the signed URLs expire, so keep it short-lived. */
    drawingTiles: (orgId: string, projectId: string, revisionId: string) =>
      queryOptions({
        queryKey: [...queryKeys.drawingRevision(orgId, revisionId, 'tiles')],
        staleTime: 5 * 60_000,
        queryFn: async () =>
          unwrap(
            await api.GET(
              '/v1/orgs/{orgId}/projects/{projectId}/drawing-revisions/{drawingRevisionId}/tiles',
              { params: { path: { orgId, projectId, drawingRevisionId: revisionId } } },
            ),
          ),
      }),
    companies: (orgId: string) =>
      queryOptions({
        queryKey: queryKeys.companies(orgId),
        queryFn: async () =>
          unwrap(await api.GET('/v1/orgs/{orgId}/companies', { params: { path: { orgId } } })),
      }),
    permissionTemplates: (orgId: string) =>
      queryOptions({
        queryKey: queryKeys.permissionTemplates(orgId),
        queryFn: async () =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/permission-templates', { params: { path: { orgId } } }),
          ),
      }),
  };
}
