'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createSpecificationsApi, type SpecSectionInput } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createSpecificationsApi(orgId), [orgId]);
}

export function useSpecBooks() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'spec-books'),
    queryFn: () => api.listBooks(projectId),
  });
}

export function useSpecBook(bookId: string | null) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'spec-books', { bookId }),
    queryFn: () => api.getBook(projectId, bookId!),
    enabled: bookId !== null,
  });
}

export function useSpecMutations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'spec-books') });
  return {
    create: useMutation({
      mutationFn: (v: { name: string; issuedDate?: string; supersedesBookId?: string }) =>
        api.createBook(projectId, v),
      onSuccess: refresh,
    }),
    saveSections: useMutation({
      mutationFn: (v: { bookId: string; version: number; sections: SpecSectionInput[] }) =>
        api.replaceSections(projectId, v.bookId, v.version, v.sections),
      onSuccess: refresh,
    }),
  };
}
