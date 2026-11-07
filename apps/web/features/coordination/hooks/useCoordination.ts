'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { fileDownloadUrl } from '@/shared/lib/uploads';
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

export function useModelFileLoader() {
  const api = useApi();
  return api.downloadModelFile;
}

export function useCoordinationIssues(filter: {
  status?: CoordinationIssueStatus;
  drawingRevisionId?: string;
  q?: string;
}) {
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
      /** A picked IFC file is stored first, so the model is only registered once its file is safe. */
      mutationFn: async (v: NewModel & { file?: File }) => {
        const { file, ...model } = v;
        const fileId = file ? await api.uploadModelFile(projectId, file) : undefined;
        return api.createModel(projectId, { ...model, ...(fileId ? { fileId } : {}) });
      },
      onSuccess: refresh,
    }),
    raise: useMutation({
      /** A snapshot of the drawing is stored first, so the issue is only raised once its picture is safe. */
      mutationFn: async (v: NewIssue & { snapshot?: Blob }) => {
        const { snapshot, ...issue } = v;
        const snapshotFileId = snapshot ? await api.uploadSnapshot(projectId, snapshot) : undefined;
        return api.createIssue(projectId, {
          ...issue,
          ...(snapshotFileId ? { snapshotFileId } : {}),
        });
      },
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

/** A short-lived URL for a stored file, such as an issue's drawing snapshot; null until it is ready. */
export function useFileUrl(fileId: string | null) {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: ['orgs', orgId, 'file-url', fileId],
    queryFn: () => fileDownloadUrl(orgId, fileId!),
    enabled: fileId !== null,
    staleTime: 4 * 60_000,
  });
}

/** The issues pinned on one drawing revision, for numbered markers and their hover cards on the sheet. */
export function useDrawingIssues(drawingRevisionId: string | null) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'coordination', { drawingRevisionId }),
    queryFn: () => api.listIssues(projectId, { drawingRevisionId: drawingRevisionId! }),
    enabled: drawingRevisionId !== null,
  });
}
