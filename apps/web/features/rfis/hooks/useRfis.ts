'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useActor } from '@/shared/providers/useActor';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createRfisApi } from '../data/api';
import { rfisSource as previewSource, type RfiFilters, type RfisSource } from '../data/source';
import type { MarkupShape } from '@archova/markup';
import type { NovaRfiSource, Rfi, RfiInput } from '../lib/types';

/** The API once the rfis endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useRfisSource(): RfisSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createRfisApi(orgId)), [orgId]);
}

export function useRfiList(projectId: string, filters: RfiFilters) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'rfis', { ...filters }),
    queryFn: () => rfisSource.list(projectId, filters),
  });
}

export function useRfi(projectId: string, rfiId: string) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'rfis', rfiId),
    queryFn: () => rfisSource.get(projectId, rfiId),
  });
}

/**
 * Every RFI write waits for the server: submitting issues a number, and responses, close, reopen and void are part
 * of the contractual record, so none of them is optimistic (frontend 02 §3).
 */
export function useRfiMutations(projectId: string) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  const actor = useActor();
  const qc = useQueryClient();
  const settle = (rfi: Rfi) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'rfis', rfi.id), rfi);
    return qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'rfis') });
  };
  return {
    create: useMutation({
      mutationFn: (v: { input: RfiInput; submit: boolean }) =>
        rfisSource.create(projectId, v.input, actor, v.submit),
      onSuccess: settle,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; input: RfiInput }) =>
        rfisSource.update(projectId, v.id, v.input, actor),
      onSuccess: settle,
    }),
    submit: useMutation({
      mutationFn: (id: string) => rfisSource.submit(projectId, id, actor),
      onSuccess: settle,
    }),
    respond: useMutation({
      mutationFn: (v: { id: string; body: string; aiSuggestionId: string | null }) =>
        rfisSource.respond(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: (v: { id: string; officialResponseId: string }) =>
        rfisSource.close(projectId, v.id, v.officialResponseId, actor),
      onSuccess: settle,
    }),
    reopen: useMutation({
      mutationFn: (v: { id: string; reason: string }) =>
        rfisSource.reopen(projectId, v.id, v.reason, actor),
      onSuccess: settle,
    }),
    void: useMutation({
      mutationFn: (v: { id: string; reason: string }) =>
        rfisSource.void(projectId, v.id, v.reason, actor),
      onSuccess: settle,
    }),
  };
}

/**
 * The images on an RFI, each with a short-lived link, and everyone's marks on them (rfis, photo annotation). The
 * links are fetched with the RFI, so a long-open tab refetches when it regains focus.
 */
export function useRfiPhotos(projectId: string, rfi: Rfi) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  const files = [...rfi.fileIds, ...rfi.responses.flatMap((r) => r.fileIds)].join(',');
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'rfis', `${rfi.id}/photos/${files}`),
    queryFn: () => rfisSource.photos(projectId, rfi),
    staleTime: 60_000,
  });
}

export function useRfiAnnotations(projectId: string, rfiId: string) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'rfis', `${rfiId}/annotations`),
    queryFn: () => rfisSource.annotations(projectId, rfiId),
  });
}

export function usePhotoMutations(projectId: string, rfiId: string) {
  const rfisSource = useRfisSource();
  const { orgId } = useCurrentOrg();
  const actor = useActor();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'rfis') });
  return {
    add: useMutation({
      mutationFn: (photo: File) => rfisSource.addPhoto(projectId, rfiId, photo),
      onSuccess: (rfi) => {
        qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'rfis', rfi.id), rfi);
        return refresh();
      },
    }),
    /** Replaces the caller's marks on one photo; an empty list removes them. */
    saveMarks: useMutation({
      mutationFn: (v: { fileId: string; shapes: readonly MarkupShape[] }) =>
        rfisSource.saveAnnotation(projectId, rfiId, v.fileId, v.shapes, actor),
      onSuccess: refresh,
    }),
  };
}

/** Nova calls are explicit user actions, never background (P6); results are suggestions until accepted. */
export function useRfiNova(projectId: string) {
  const rfisSource = useRfisSource();
  return {
    /** F3: a new RFI drafted from a note typed on site, a photo, a drawing markup, or any mix. */
    draftRfi: useMutation({
      mutationFn: (source: NovaRfiSource) => rfisSource.novaDraftRfi(projectId, source),
    }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'accepted' | 'edited' | 'rejected' }) =>
        rfisSource.novaDecide(projectId, v.id, v.decision),
    }),
    /** The person who will answer, with what they want the answer to say (may be empty). */
    draftResponse: useMutation({
      mutationFn: (v: { rfiId: string; direction?: string }) =>
        rfisSource.novaDraftResponse(projectId, v.rfiId, v.direction),
    }),
    improveQuestion: useMutation({
      mutationFn: (text: string) => rfisSource.novaImproveQuestion(text),
    }),
    /** "Check for similar RFIs" before submit (RFI-US3). */
    similar: useMutation({
      mutationFn: (subject: string) => rfisSource.novaSimilar(projectId, subject),
    }),
  };
}
