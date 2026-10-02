'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useActor } from '@/shared/providers/useActor';
import { rfisSource, type RfiFilters } from '../data/source';
import type { Rfi, RfiInput } from '../lib/types';

export function useRfiList(projectId: string, filters: RfiFilters) {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'rfis', { ...filters }),
    queryFn: () => rfisSource.list(projectId, filters),
  });
}

export function useRfi(projectId: string, rfiId: string) {
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

/** Nova calls are explicit user actions, never background (P6); results are suggestions until accepted. */
export function useRfiNova(projectId: string) {
  return {
    draftResponse: useMutation({
      mutationFn: (rfiId: string) => rfisSource.novaDraftResponse(projectId, rfiId),
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
