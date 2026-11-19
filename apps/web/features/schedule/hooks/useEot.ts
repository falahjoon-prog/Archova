'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createEotApi,
  type AddEvidence,
  type CreateDelayEvent,
  type DraftKind,
  type EventTransition,
  type PutEotSettings,
  type UpdateDelayEvent,
} from '../data/eot';

function useEotApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createEotApi(orgId), [orgId]);
}

export function useDelayEvents(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'eot', { view: 'list' }),
    queryFn: () => source.list(projectId),
  });
}

export function useDelayEvent(projectId: string, eventId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'eot', { view: 'detail', eventId }),
    queryFn: () => source.get(projectId, eventId!),
    enabled: eventId !== null,
  });
}

export function useEotInsights(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'eot', { view: 'insights' }),
    queryFn: () => source.insights(projectId),
    // Deadlines move with the date, so look again every few minutes while the board is open.
    refetchInterval: 5 * 60_000,
  });
}

export function useEotSettings(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'eot', { view: 'settings' }),
    queryFn: () => source.settings(projectId),
  });
}

export function useEventCandidates(projectId: string, enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'eot', { view: 'candidates' }),
    queryFn: () => source.candidates(projectId),
    enabled,
  });
}

export function useEotMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEotApi();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'eot') });
  return {
    create: useMutation({
      mutationFn: (body: CreateDelayEvent) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { eventId: string; body: UpdateDelayEvent }) =>
        source.update(projectId, v.eventId, v.body),
      onSuccess: refresh,
    }),
    addEvidence: useMutation({
      mutationFn: (v: { eventId: string; body: AddEvidence }) =>
        source.addEvidence(projectId, v.eventId, v.body),
      onSuccess: refresh,
    }),
    removeEvidence: useMutation({
      mutationFn: (v: { eventId: string; itemId: string }) =>
        source.removeEvidence(projectId, v.eventId, v.itemId),
      onSuccess: refresh,
    }),
    transition: useMutation({
      mutationFn: (v: { eventId: string; body: EventTransition }) =>
        source.transition(projectId, v.eventId, v.body),
      onSuccess: refresh,
    }),
    saveSettings: useMutation({
      mutationFn: (body: PutEotSettings) => source.putSettings(projectId, body),
      onSuccess: refresh,
    }),
    // A draft changes only the event history, so only the detail needs a look again.
    draft: useMutation({
      mutationFn: (v: { eventId: string; kind: DraftKind; senderName?: string }) =>
        source.draft(projectId, v.eventId, {
          kind: v.kind,
          ...(v.senderName ? { senderName: v.senderName } : {}),
        }),
      onSuccess: refresh,
    }),
  };
}

export type EotMutations = ReturnType<typeof useEotMutations>;
