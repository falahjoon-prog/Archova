'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  createCoordinationApi,
  type CoordinationIssueStatus,
  type IssueChanges,
  type NewIssue,
  type NewModel,
} from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createCoordinationApi(orgId), [orgId]);
}

export function useBimModels() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'coordination', { models: true }),
    queryFn: () => api.listModels(projectId),
  });
}

export function useCoordinationIssues(filter: { status?: CoordinationIssueStatus; q?: string }) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'coordination', { ...filter }),
    queryFn: () => api.listIssues(projectId, filter),
  });
}

export function useCoordinationIssue(issueId: string | null) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'coordination', issueId ?? ''),
    queryFn: () => api.getIssue(projectId, issueId!),
    enabled: issueId !== null,
  });
}

export function useCoordinationMutations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'coordination') });
  return {
    registerModel: useMutation({
      mutationFn: (v: NewModel) => api.createModel(projectId, v),
      onSuccess: refresh,
    }),
    raise: useMutation({
      mutationFn: (v: NewIssue) => api.createIssue(projectId, v),
      onSuccess: refresh,
    }),
    change: useMutation({
      mutationFn: (v: { issueId: string; version: number; changes: IssueChanges }) =>
        api.updateIssue(projectId, v.issueId, v.version, v.changes),
      onSuccess: refresh,
    }),
    comment: useMutation({
      mutationFn: (v: { issueId: string; body: string }) =>
        api.addComment(projectId, v.issueId, v.body),
      onSuccess: refresh,
    }),
  };
}
