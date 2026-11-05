'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createAccountingApi,
  type FieldMap,
  type Provider,
  type Settings,
  type Target,
} from '../data/api';

const keys = (orgId: string) => ({
  connections: ['orgs', orgId, 'accounting', 'connections'] as const,
  issues: ['orgs', orgId, 'accounting', 'issues'] as const,
});

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createAccountingApi(orgId), [orgId]);
}

export function useConnections() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).connections, queryFn: () => source.connections() });
}

/** Asks for the sign-in address; the caller sends the browser there. */
export function useStartConnection() {
  const source = useApi();
  return useMutation({ mutationFn: (provider: Provider) => source.start(provider) });
}

export function useTargets(provider: Provider, enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: [...keys(orgId).connections, provider, 'targets'],
    queryFn: () => source.targets(provider),
    enabled,
  });
}

function useConnectionMutation<V>(
  fn: (source: ReturnType<typeof createAccountingApi>, v: V) => Promise<unknown>,
) {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: V) => fn(source, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['orgs', orgId, 'accounting'] }),
  });
}

export const useSelectTarget = (provider: Provider) =>
  useConnectionMutation<Target>((s, v) => s.selectTarget(provider, v));
export const useSaveFieldMap = (provider: Provider) =>
  useConnectionMutation<FieldMap>((s, v) => s.saveFieldMap(provider, v));
export const useSaveSettings = (provider: Provider) =>
  useConnectionMutation<Settings>((s, v) => s.saveSettings(provider, v));
export const useDisconnect = (provider: Provider) =>
  useConnectionMutation<void>((s) => s.disconnect(provider));
export const useResolveIssue = () => useConnectionMutation<string>((s, id) => s.resolveIssue(id));

export function useSyncIssues() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({ queryKey: keys(orgId).issues, queryFn: () => source.issues() });
}
