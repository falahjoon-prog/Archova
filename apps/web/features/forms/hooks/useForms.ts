'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { projectMembers } from '@/shared/lib/people';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createFormsApi, type SubmissionFilters } from '../data/api';
import type { FormTemplateInput } from '../lib/types';

function useScope() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const api = useMemo(() => createFormsApi(orgId), [orgId]);
  return { orgId, projectId, api };
}

export function useFormTemplates() {
  const { orgId, projectId, api } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { view: 'templates' }),
    queryFn: () => api.templates(projectId),
  });
}

export function useFormSubmissions(filters: SubmissionFilters) {
  const { orgId, projectId, api } = useScope();
  return useInfiniteQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { view: 'list', ...filters }),
    queryFn: ({ pageParam }) => api.submissions(projectId, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** The few forms Nova thinks need a nudge, whatever filters the list has on. */
export function useFlaggedForms() {
  const { orgId, projectId, api } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { view: 'flagged' }),
    queryFn: () => api.submissions(projectId, { flagged: true }),
  });
}

export function useFormSubmission(id: string | null) {
  const { orgId, projectId, api } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'forms', { id }),
    queryFn: () => api.submission(projectId, id!),
    enabled: id !== null,
  });
}

export function useMemberNames() {
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: ['forms', orgId, projectId, 'members'],
    queryFn: () => projectMembers(orgId, projectId),
    staleTime: 5 * 60_000,
  });
}

function useRefresh() {
  const { orgId, projectId } = useScope();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'forms') });
}

export function useTemplateMutations() {
  const { projectId, api } = useScope();
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    create: useMutation({
      mutationFn: (b: FormTemplateInput) => api.createTemplate(projectId, b),
      ...opts,
    }),
    update: useMutation({
      mutationFn: (a: { id: string; body: FormTemplateInput }) =>
        api.updateTemplate(projectId, a.id, a.body),
      ...opts,
    }),
    publish: useMutation({
      mutationFn: (id: string) => api.publishTemplate(projectId, id),
      ...opts,
    }),
    archive: useMutation({
      mutationFn: (id: string) => api.archiveTemplate(projectId, id),
      ...opts,
    }),
    newVersion: useMutation({
      mutationFn: (id: string) => api.newTemplateVersion(projectId, id),
      ...opts,
    }),
  };
}

export function useAssignForm() {
  const { projectId, api } = useScope();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (b: Parameters<typeof api.assign>[1]) => api.assign(projectId, b),
    onSuccess: refresh,
  });
}

export function useSubmissionMutations(id: string) {
  const { projectId, api } = useScope();
  const refresh = useRefresh();
  const opts = { onSuccess: refresh };
  return {
    save: useMutation({
      mutationFn: (b: Parameters<typeof api.save>[2]) => api.save(projectId, id, b),
      ...opts,
    }),
    submit: useMutation({ mutationFn: () => api.submit(projectId, id), ...opts }),
    review: useMutation({
      mutationFn: (d: 'close' | 'return') => api.review(projectId, id, d),
      ...opts,
    }),
    suggest: useMutation({ mutationFn: () => api.suggestions(projectId, id) }),
    upload: useMutation({ mutationFn: (file: File) => api.upload(projectId, file) }),
  };
}
