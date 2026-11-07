'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createNovaSettingsApi, type AiSettings, type UpdateAiSettings } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createNovaSettingsApi(orgId), [orgId]);
}

const settingsKey = (orgId: string) => ['orgs', orgId, 'ai', 'settings'] as const;
const usageKey = (orgId: string) => ['orgs', orgId, 'ai', 'usage'] as const;

export function useNovaSettings() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({ queryKey: settingsKey(orgId), queryFn: () => api.settings() });
}

export function useNovaUsage() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({ queryKey: usageKey(orgId), queryFn: () => api.usage(), retry: false });
}

export function useSaveNovaSettings() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { current: AiSettings; patch: UpdateAiSettings }) =>
      api.update(v.current, v.patch),
    onSuccess: async (saved) => {
      qc.setQueryData(settingsKey(orgId), saved);
      // The cap changes what the allowance shows, so refresh usage too.
      await qc.invalidateQueries({ queryKey: usageKey(orgId) });
    },
  });
}
