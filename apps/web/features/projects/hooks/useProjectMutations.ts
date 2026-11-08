'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type {
  AddProjectMemberRequest,
  CreateProjectRequest,
  UpdateProjectRequest,
} from '@archova/contracts';
import { queryKeys } from '@archova/query';
import { api, ensureCsrfToken } from '@/shared/lib/api';

/** POST /v1/orgs/{orgId}/projects. Not optimistic: waits for the server, then refreshes the list. */
export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectRequest) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects', { params: { path: { orgId } }, body }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projects(orgId) }),
  });
}

/** POST /v1/orgs/{orgId}/projects/{projectId}/members. */
export function useAddProjectMember(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AddProjectMemberRequest) => {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/projects/{projectId}/members', {
          params: { path: { orgId, projectId } },
          body,
        }),
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(orgId, projectId) }),
  });
}

/** PATCH /v1/orgs/{orgId}/projects/{projectId}. Sends the version it was read at, so a stale edit is refused. */
export function useUpdateProject(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ version, body }: { version: number; body: UpdateProjectRequest }) => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/projects/{projectId}', {
          params: { path: { orgId, projectId }, header: { 'If-Match': `"${version}"` } },
          body,
        }),
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.project(orgId, projectId) }),
  });
}
