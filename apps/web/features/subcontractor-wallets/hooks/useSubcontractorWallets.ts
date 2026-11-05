'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queries } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createSubcontractorWalletsApi,
  type AccessRequest,
  type CreateAccessRequest,
  type SnapshotReason,
} from '../data/api';

const key = (orgId: string) => ['orgs', orgId, 'subcontractor-wallets'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createSubcontractorWalletsApi(orgId), [orgId]);
}

/** The org's projects, for choosing what a request or a read is for. */
export function useProjectChoices() {
  const { orgId } = useCurrentOrg();
  return useQuery(queries.projects(orgId));
}

export function useAccessRequests() {
  const { orgId } = useCurrentOrg();
  const wallets = useApi();
  return useQuery({ queryKey: [...key(orgId), 'requests'], queryFn: () => wallets.requests() });
}

export function useGrantedWallets() {
  const { orgId } = useCurrentOrg();
  const wallets = useApi();
  return useQuery({ queryKey: [...key(orgId), 'granted'], queryFn: () => wallets.wallets() });
}

/** Reading writes the subcontractor's access log, so it never refetches by itself. */
export function useSharedDocuments(grantId: string, projectId: string) {
  const { orgId } = useCurrentOrg();
  const wallets = useApi();
  return useQuery({
    queryKey: [...key(orgId), 'documents', grantId, projectId],
    queryFn: () => wallets.documents(grantId, projectId),
    enabled: projectId !== '',
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

export function useSubcontractorWalletMutations() {
  const { orgId } = useCurrentOrg();
  const wallets = useApi();
  const qc = useQueryClient();
  const settle = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: [...key(orgId), 'requests'] });
    return v;
  };
  return {
    request: useMutation({
      mutationFn: async (body: CreateAccessRequest) => settle(await wallets.createRequest(body)),
    }),
    cancel: useMutation({
      mutationFn: async (r: AccessRequest) => settle(await wallets.cancelRequest(r)),
    }),
    /** A link is fetched when asked for and used straight away; it is only good for a minute. */
    openFile: useMutation({
      mutationFn: (v: {
        grantId: string;
        projectId: string;
        documentId: string;
        position: number;
      }) => wallets.fileLink(v.grantId, v.projectId, v.documentId, v.position),
    }),
    snapshot: useMutation({
      mutationFn: (v: {
        grantId: string;
        projectId: string;
        documentId: string;
        reason: SnapshotReason;
      }) => wallets.snapshot(v.grantId, v),
    }),
  };
}
