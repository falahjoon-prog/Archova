'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createSharingApi, type Grant } from '../data/sharing-api';

const key = (orgId: string) => ['orgs', orgId, 'compliance-sharing'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createSharingApi(orgId), [orgId]);
}

export function useGrants() {
  const { orgId } = useCurrentOrg();
  const sharing = useApi();
  return useQuery({ queryKey: [...key(orgId), 'grants'], queryFn: () => sharing.grants() });
}

export function useAccessLog() {
  const { orgId } = useCurrentOrg();
  const sharing = useApi();
  return useQuery({ queryKey: [...key(orgId), 'log'], queryFn: () => sharing.log() });
}

export function useSharingMutations() {
  const { orgId } = useCurrentOrg();
  const sharing = useApi();
  const qc = useQueryClient();
  const settle = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: key(orgId) });
    return v;
  };
  return {
    preview: useMutation({ mutationFn: (code: string) => sharing.preview(code) }),
    accept: useMutation({ mutationFn: async (code: string) => settle(await sharing.accept(code)) }),
    revoke: useMutation({ mutationFn: async (g: Grant) => settle(await sharing.revoke(g)) }),
  };
}
