'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createTmApi,
  type ConvertTmTicket,
  type SignTmTicket,
  type TmTicketRequest,
} from '../data/api';

function useTmApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createTmApi(orgId), [orgId]);
}

export function useTmTickets(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTmApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'tm-tickets', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useTmTicket(projectId: string, id: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useTmApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'tm-tickets', id ?? ''),
    queryFn: () => source.get(projectId, id!),
    enabled: id !== null,
  });
}

/** Nova's checks on one ticket (diary, timesheets, equipment logs, where it was signed). Advice only. */
export function useTmChecks(projectId: string, id: string, version: string) {
  const { orgId } = useCurrentOrg();
  const source = useTmApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'tm-tickets', `${id}:checks:${version}`),
    queryFn: () => source.checks(projectId, id),
  });
}

/** Nova's draft for a day. Fetched on demand, never cached: it changes as timesheets and logs come in. */
export function useTmSuggestion(projectId: string) {
  const source = useTmApi();
  return useMutation({ mutationFn: (date: string) => source.suggest(projectId, date) });
}

/** Money is never optimistic. Converting also moves the budget, the forecast and the variations, so those refresh. */
export function useTmMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTmApi();
  const qc = useQueryClient();
  const refresh = () =>
    Promise.all(
      (['tm-tickets', 'budget', 'cost-forecast', 'contracts'] as const).map((tool) =>
        qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, tool) }),
      ),
    );
  return {
    create: useMutation({
      mutationFn: (body: TmTicketRequest) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    sign: useMutation({
      mutationFn: (v: {
        id: string;
        body: Omit<SignTmTicket, 'evidenceFileId'> & { evidence?: File };
      }) => source.sign(projectId, v.id, v.body),
      onSuccess: refresh,
    }),
    voidTicket: useMutation({
      mutationFn: (v: { id: string; note: string }) => source.voidTicket(projectId, v.id, v.note),
      onSuccess: refresh,
    }),
    convert: useMutation({
      mutationFn: (v: { id: string; body: ConvertTmTicket }) =>
        source.convert(projectId, v.id, v.body),
      onSuccess: refresh,
    }),
  };
}
