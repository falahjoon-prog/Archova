// TanStack query key factories and queryOptions per resource (ADR-0006). Hooks stay in each app; keys live here
// so web and mobile invalidate the same way. The objects are plain `{ queryKey, queryFn }` options that
// TanStack Query (react-query on web and mobile) accepts directly.
import { unwrap, type ApiClient } from '@archova/api-client';

export const queryKeys = {
  me: () => ['me'] as const,
  org: (orgId: string) => ['orgs', orgId] as const,
  entitlements: (orgId: string) => ['orgs', orgId, 'entitlements'] as const,
  projects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  project: (orgId: string, projectId: string) => ['orgs', orgId, 'projects', projectId] as const,
  projectMembers: (orgId: string, projectId: string) =>
    ['orgs', orgId, 'projects', projectId, 'members'] as const,
  projectPermissions: (orgId: string, projectId: string) =>
    ['orgs', orgId, 'projects', projectId, 'permissions'] as const,
  companies: (orgId: string) => ['orgs', orgId, 'companies'] as const,
  permissionTemplates: (orgId: string) => ['orgs', orgId, 'permission-templates'] as const,
};

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
