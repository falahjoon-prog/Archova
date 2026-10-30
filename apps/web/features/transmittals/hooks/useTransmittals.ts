'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createTransmittalsApi } from '../data/api';
import type { CreateTransmittal } from '../lib/types';

function useTransmittalsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createTransmittalsApi(orgId), [orgId]);
}

export function useTransmittals(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTransmittalsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'transmittals', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useSendable(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTransmittalsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'transmittals', { sendable: true }),
    queryFn: () => source.listSendable(projectId),
  });
}

export function useTransmittal(projectId: string, transmittalId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTransmittalsApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'transmittals', transmittalId),
    queryFn: () => source.get(projectId, transmittalId),
    // Receipts arrive while the page is open.
    refetchInterval: (q) => (q.state.data?.transmittal.status === 'sent' ? 30_000 : false),
  });
}

/** Sending changes the record for everyone, so each mutation waits for the server and then refreshes the lists. */
export function useTransmittalMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTransmittalsApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'transmittals') });
  return {
    create: useMutation({
      mutationFn: (body: CreateTransmittal) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    send: useMutation({
      mutationFn: (v: { id: string; version: number }) => source.send(projectId, v.id, v.version),
      onSuccess: refresh,
    }),
    resend: useMutation({
      mutationFn: (v: { id: string; recipientId: string }) =>
        source.resend(projectId, v.id, v.recipientId),
      onSuccess: refresh,
    }),
  };
}
