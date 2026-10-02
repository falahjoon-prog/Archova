'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type { AddProjectMemberRequest, CreateProjectRequest } from '@archova/contracts';
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
