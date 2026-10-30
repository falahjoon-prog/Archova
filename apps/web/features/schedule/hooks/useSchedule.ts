'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createScheduleApi, type RegisterFilters, type UpdateKeyDates } from '../data/api';

function useScheduleApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createScheduleApi(orgId), [orgId]);
}

export function useKeyDates(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useScheduleApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'key-dates', {}),
    queryFn: () => source.keyDates(projectId),
  });
}

export function useKeyDateChanges(projectId: string, enabled: boolean) {
  const { orgId } = useCurrentOrg();
  const source = useScheduleApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'key-dates', { changes: true }),
    queryFn: () => source.keyDateChanges(projectId),
    enabled,
  });
}

/** A save changes what everyone sees, so it waits for the server and then refreshes the dates and their history. */
export function useUpdateKeyDates(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useScheduleApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { version: number; body: UpdateKeyDates }) =>
      source.updateKeyDates(projectId, v.version, v.body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'key-dates') }),
  });
}

export function useDelayRegister(projectId: string, filters: RegisterFilters) {
  const { orgId } = useCurrentOrg();
  const source = useScheduleApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'delays', filters),
    queryFn: () => source.delayRegister(projectId, filters),
  });
}
