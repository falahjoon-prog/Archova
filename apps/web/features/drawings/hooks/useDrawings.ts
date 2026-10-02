'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { MarkupShape, MarkupVisibility } from '@archova/markup';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useActor } from '@/shared/providers/useActor';
import { createDrawingsApi } from '../data/api';
import {
  drawingsSource as previewSource,
  type DrawingFilters,
  type DrawingsSource,
  type NewDrawingSetInput,
  type ReviewSheetPatch,
} from '../data/source';

/** The API source, or the in-browser preview when preview data is on (shared/lib/data-mode). */
export function useDrawingsSource(): DrawingsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createDrawingsApi(orgId)), [orgId]);
}

// Data hooks for drawings (frontend 01 §3). Keys come from @archova/query so mobile invalidates the same way.

export function useSheets(projectId: string, filters: DrawingFilters) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'drawings', filters),
    queryFn: () => drawingsSource.listSheets(projectId, filters),
  });
}

export function useAllRevisions(projectId: string, enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'drawings', { all: true }),
    queryFn: () => drawingsSource.listAllRevisions(projectId),
    enabled,
  });
}

export function useSheet(projectId: string, sheetId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'drawings', sheetId),
    queryFn: () => drawingsSource.getSheet(projectId, sheetId),
    staleTime: 60_000,
  });
}

export function useGeometry(projectId: string, revisionId: string | undefined) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.drawingRevision(orgId, revisionId ?? '', 'geometry'),
    queryFn: () => drawingsSource.getGeometry(projectId, revisionId!),
    enabled: Boolean(revisionId),
    // Geometry files are fetched once per sheet and kept for the session (frontend 07 §6).
    staleTime: Infinity,
  });
}

export function usePins(projectId: string, revisionId: string | undefined) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.drawingRevision(orgId, revisionId ?? '', 'pins'),
    queryFn: () => drawingsSource.listPins(projectId, revisionId!),
    enabled: Boolean(revisionId),
  });
}

export function useMarkups(projectId: string, revisionId: string | undefined) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const actor = useActor();
  return useQuery({
    queryKey: queryKeys.drawingRevision(orgId, revisionId ?? '', 'markups'),
    queryFn: () => drawingsSource.listMarkups(projectId, revisionId!, actor),
    enabled: Boolean(revisionId),
  });
}

export function useConfirmScale(projectId: string, revisionId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const actor = useActor();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (scale: string) => drawingsSource.confirmScale(projectId, revisionId, scale, actor),
    onSuccess: (geometry) =>
      qc.setQueryData(queryKeys.drawingRevision(orgId, revisionId, 'geometry'), geometry),
  });
}

export function useConfirmPinLocation(projectId: string, revisionId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pinId: string) => drawingsSource.confirmPinLocation(projectId, revisionId, pinId),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.drawingRevision(orgId, revisionId, 'pins') }),
  });
}

export function useMarkupMutations(projectId: string, revisionId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const actor = useActor();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.drawingRevision(orgId, revisionId, 'markups') });
  return {
    create: useMutation({
      mutationFn: (input: { shape: MarkupShape; visibility: MarkupVisibility }) =>
        drawingsSource.createMarkup(projectId, revisionId, input, actor),
      onSuccess: invalidate,
    }),
    setVisibility: useMutation({
      mutationFn: (input: { markupId: string; visibility: MarkupVisibility }) =>
        drawingsSource.setMarkupVisibility(
          projectId,
          revisionId,
          input.markupId,
          input.visibility,
          actor,
        ),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (markupId: string) =>
        drawingsSource.deleteMarkup(projectId, revisionId, markupId, actor),
      onSuccess: invalidate,
    }),
  };
}

export function useDrawingSet(projectId: string, setId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'drawing-sets', setId),
    queryFn: () => drawingsSource.getSet(projectId, setId),
  });
}

export function useCreateDrawingSet(projectId: string) {
  const drawingsSource = useDrawingsSource();
  return useMutation({
    mutationFn: (input: NewDrawingSetInput) => drawingsSource.createSet(projectId, input),
  });
}

export function useReviewSheetUpdate(projectId: string, setId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { sheetId: string; patch: ReviewSheetPatch }) =>
      drawingsSource.updateReviewSheet(projectId, setId, input.sheetId, input.patch),
    onSuccess: (set) =>
      qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'drawing-sets', setId), set),
  });
}

/** Publishing supersedes revisions, which carries legal weight: never optimistic (frontend 02 §3). */
export function usePublishDrawingSet(projectId: string, setId: string) {
  const { orgId } = useCurrentOrg();
  const drawingsSource = useDrawingsSource();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => drawingsSource.publishSet(projectId, setId),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'drawings') }),
        qc.invalidateQueries({
          queryKey: queryKeys.toolItem(orgId, projectId, 'drawing-sets', setId),
        }),
      ]),
  });
}
