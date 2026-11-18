'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createLocationsApi, type CreateLocation, type UpdateLocation } from '../data/locations';

function useLocationsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createLocationsApi(orgId), [orgId]);
}

export function useProjectLocations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useLocationsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'locations', {}),
    queryFn: () => source.list(projectId),
  });
}

/** Saves change what everyone sees, so they wait for the server and then refresh the list. */
export function useLocationMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useLocationsApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'locations') });
  return {
    create: useMutation({
      mutationFn: (body: CreateLocation) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (v: { id: string; version: number; body: UpdateLocation }) =>
        source.update(projectId, v.id, v.version, v.body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (id: string) => source.remove(projectId, id),
      onSuccess: refresh,
    }),
  };
}
