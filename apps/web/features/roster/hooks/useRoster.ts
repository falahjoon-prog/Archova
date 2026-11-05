'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createRosterApi, type CreateShift, type ShiftResponse } from '../data/api';

function useRosterApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createRosterApi(orgId), [orgId]);
}

export function useShifts(projectId: string, from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useRosterApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'roster', { from, to }),
    queryFn: () => source.shifts(projectId, from, to),
  });
}

/** An assignment moves the shift's filled count, so every change refreshes the whole list. */
export function useRosterMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useRosterApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'roster') });
  return {
    createShift: useMutation({
      mutationFn: (body: CreateShift) => source.createShift(projectId, body),
      onSuccess: refresh,
    }),
    publish: useMutation({
      mutationFn: (shiftId: string) => source.publish(projectId, shiftId),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: (shiftId: string) => source.cancel(projectId, shiftId),
      onSuccess: refresh,
    }),
    assign: useMutation({
      mutationFn: (v: { shiftId: string; workerIds: string[] }) =>
        source.assign(projectId, v.shiftId, v.workerIds),
      onSuccess: refresh,
    }),
    unassign: useMutation({
      mutationFn: (v: { shiftId: string; assignmentId: string }) =>
        source.unassign(projectId, v.shiftId, v.assignmentId),
      onSuccess: refresh,
    }),
    respond: useMutation({
      mutationFn: (v: { shiftId: string; assignmentId: string; status: ShiftResponse }) =>
        source.respond(projectId, v.shiftId, v.assignmentId, v.status),
      onSuccess: refresh,
    }),
  };
}
