'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type {
  AddProjectMemberRequest,
  CreateCompanyContactRequest,
  CreateProjectRequest,
  UpdateCompanyContactRequest,
  UpdateProjectMemberRequest,
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

/** PATCH …/members/{memberId}: the phone, job title and trade shown in the directory. */
export function useUpdateProjectMember(orgId: string, projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { memberId: string; body: UpdateProjectMemberRequest }) => {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH('/v1/orgs/{orgId}/projects/{projectId}/members/{memberId}', {
          params: { path: { orgId, projectId, memberId: vars.memberId } },
          body: vars.body,
        }),
      );
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.projectMembers(orgId, projectId) }),
  });
}

const contactsKey = (orgId: string) => ['orgs', orgId, 'company-contacts'] as const;

/** Company contacts: people with no login, shared by every project in the org. */
export function useCompanyContacts(orgId: string, enabled = true) {
  return useQuery({
    queryKey: contactsKey(orgId),
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET('/v1/orgs/{orgId}/company-contacts', {
          params: { path: { orgId }, query: { limit: 200 } },
        }),
      ),
  });
}

export function useSaveCompanyContact(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id?: string;
      body: CreateCompanyContactRequest | UpdateCompanyContactRequest;
    }) => {
      await ensureCsrfToken();
      return vars.id
        ? unwrap(
            await api.PATCH('/v1/orgs/{orgId}/company-contacts/{contactId}', {
              params: { path: { orgId, contactId: vars.id } },
              body: vars.body as UpdateCompanyContactRequest,
            }),
          )
        : unwrap(
            await api.POST('/v1/orgs/{orgId}/company-contacts', {
              params: { path: { orgId } },
              body: vars.body as CreateCompanyContactRequest,
            }),
          );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactsKey(orgId) }),
  });
}

export function useDeleteCompanyContact(orgId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contactId: string) => {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/company-contacts/{contactId}', {
          params: { path: { orgId, contactId } },
        }),
      );
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: contactsKey(orgId) }),
  });
}
