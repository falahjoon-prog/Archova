'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createLocationsApi, type CreateLocation, type UpdateLocation } from '../data/api';

function useLocationsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createLocationsApi(orgId), [orgId]);
}

export function useLocations(projectId: string, includeArchived = false) {
  const { orgId } = useCurrentOrg();
  const source = useLocationsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'locations', { includeArchived }),
    queryFn: () => source.list(projectId, includeArchived),
  });
}

/** Nova's suggestions for the words typed so far; waits until there is something to read. */
export function useLocationSuggestions(projectId: string, text: string) {
  const { orgId } = useCurrentOrg();
  const source = useLocationsApi();
  const trimmed = text.trim();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'locations', { suggest: trimmed }),
    queryFn: () => source.suggest(projectId, trimmed.slice(0, 2000)),
    enabled: trimmed.length >= 3,
    staleTime: 60_000,
  });
}

function useRefresh(projectId: string) {
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'locations') });
}

export function useCreateLocation(projectId: string) {
  const source = useLocationsApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (body: CreateLocation) => source.create(projectId, body),
    onSuccess: refresh,
  });
}

export function useUpdateLocation(projectId: string) {
  const source = useLocationsApi();
  const refresh = useRefresh(projectId);
  return useMutation({
    mutationFn: (v: { id: string; version: number; body: UpdateLocation }) =>
      source.update(projectId, v.id, v.version, v.body),
    onSuccess: refresh,
  });
}
