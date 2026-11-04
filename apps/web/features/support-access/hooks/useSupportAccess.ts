'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { queries } from '@/shared/lib/api';
import { createSupportAccessApi, type CreateGrant } from '../data/api';

const keys = (orgId: string) => ({
  all: ['orgs', orgId, 'support-access'] as const,
  banner: ['orgs', orgId, 'support-access', 'banner'] as const,
  actions: ['orgs', orgId, 'staff-actions'] as const,
});

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createSupportAccessApi(orgId), [orgId]);
}

export function useSupportAccess() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).all, queryFn: () => source.get() });
}

export function useStaffActions() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).actions, queryFn: () => source.staffActions() });
}

/** Polled so everyone sees the banner within a minute of a session opening, and it clears soon after it ends. */
export function useSupportBanner() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: keys(orgId).banner,
    queryFn: () => source.banner(),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useGrantSupportAccess() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateGrant) => source.grant(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).all }),
  });
}

export function useRevokeSupportAccess() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (grantId: string) => source.revoke(grantId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys(orgId).all }),
  });
}

/** The company's projects, for choosing which ones support may see. */
export function useSupportProjectChoices() {
  const { orgId } = useCurrentOrg();
  return useQuery(queries.projects(orgId));
}
