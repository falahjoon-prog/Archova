'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useActor } from '@/shared/providers/useActor';
import { createDocumentsApi } from '../data/api';
import { documentsSource as previewSource, type DocumentsSource } from '../data/source';
import type { NewRevisionInput } from '../lib/types';

/** The API source, or the in-browser preview when preview data is on (shared/lib/data-mode). */
export function useDocumentsSource(): DocumentsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createDocumentsApi(orgId)), [orgId]);
}

export function useFolders(projectId: string) {
  const { orgId } = useCurrentOrg();
  const documentsSource = useDocumentsSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { folders: true }),
    queryFn: () => documentsSource.listFolders(projectId),
    staleTime: 60_000,
  });
}

export function useDocuments(projectId: string, folderId: string | null) {
  const { orgId } = useCurrentOrg();
  const documentsSource = useDocumentsSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { folderId }),
    queryFn: () => documentsSource.listDocuments(projectId, folderId),
  });
}

export function useDocumentRevisions(projectId: string, documentId: string | null) {
  const { orgId } = useCurrentOrg();
  const documentsSource = useDocumentsSource();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'documents', documentId ?? ''),
    queryFn: () => documentsSource.listRevisions(projectId, documentId!),
    enabled: Boolean(documentId),
  });
}

/** A new revision supersedes the old one: wait for the server (frontend 02 §3). */
export function useAddRevision(projectId: string) {
  const { orgId } = useCurrentOrg();
  const documentsSource = useDocumentsSource();
  const actor = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NewRevisionInput & { documentId: string }) =>
      documentsSource.addRevision(projectId, input.documentId, input, actor),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'documents') }),
  });
}
