'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createAttendanceApi } from '../data/api';
import { checkInPreview, createCheckInApi } from '../data/checkin';
import { attendancePreview, type AttendanceSource } from '../data/source';
import type {
  AttendanceSite,
  Gate,
  RollCall,
  RollMark,
  SiteInput,
  Worker,
  WorkerFilters,
  WorkerInput,
} from '../lib/types';

function useAttendanceSource(): AttendanceSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? attendancePreview : createAttendanceApi(orgId)), [orgId]);
}

/** Who is on site now. Refreshed every minute while the screen is open. */
export function useOnSite() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'attendance', { view: 'on-site' }),
    queryFn: () => source.onSite(projectId),
    refetchInterval: 60_000,
  });
}

export function useAttendanceDay(date: string, companyId?: string) {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'attendance', { date, companyId }),
    queryFn: () => source.day(projectId, date, companyId),
  });
}

export function useSites() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'attendance', { view: 'sites' }),
    queryFn: () => source.sites(projectId),
  });
}

/** Sites and gates change rarely and a code is shown once, so none of these is optimistic. */
export function useSiteMutations() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const settle = <T>(value: T) => {
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'attendance') });
    return value;
  };
  return {
    createSite: useMutation({
      mutationFn: async (input: SiteInput) => settle(await source.createSite(projectId, input)),
    }),
    updateSite: useMutation({
      mutationFn: async (v: {
        site: AttendanceSite;
        patch: Partial<SiteInput> & { active?: boolean };
      }) => settle(await source.updateSite(projectId, v.site, v.patch)),
    }),
    createGate: useMutation({
      mutationFn: async (v: { siteId: string; name: string }) =>
        settle(await source.createGate(projectId, v.siteId, v.name)),
    }),
    updateGate: useMutation({
      mutationFn: async (v: { gate: Gate; patch: { name?: string; active?: boolean } }) =>
        settle(await source.updateGate(projectId, v.gate, v.patch)),
    }),
    reissueGate: useMutation({
      mutationFn: async (gate: Gate) => settle(await source.reissueGate(projectId, gate)),
    }),
  };
}

/** Roll calls, newest first. While one is open the list refreshes every 10 seconds so other supervisors' ticks show. */
export function useRollCalls() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'attendance', { view: 'roll-calls' }),
    queryFn: () => source.rollCalls(projectId),
    refetchInterval: (q) => (q.state.data?.some((r) => !r.endedAt) ? 10_000 : false),
  });
}

/** Marks are a record of an emergency, so they are saved first and shown from the server's answer. */
export function useRollCallMutations() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const key = queryKeys.toolList(orgId, projectId, 'attendance', { view: 'roll-calls' });
  const put = (rc: RollCall) => {
    qc.setQueryData<RollCall[]>(key, (list) => {
      const rest = (list ?? []).filter((r) => r.id !== rc.id);
      return [rc, ...rest].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    });
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'attendance') });
    return rc;
  };
  return {
    start: useMutation({
      mutationFn: async (input: { reason: string; siteId?: string }) =>
        put(await source.startRollCall(projectId, input)),
    }),
    mark: useMutation({
      mutationFn: async (v: {
        rollCallId: string;
        workerId: string;
        status: Exclude<RollMark, 'unmarked'>;
      }) => put(await source.markRollCall(projectId, v.rollCallId, v.workerId, v.status)),
    }),
    end: useMutation({
      mutationFn: async (rollCallId: string) =>
        put(await source.endRollCall(projectId, rollCallId)),
    }),
  };
}

export function useWorkers(filters: WorkerFilters) {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'attendance', { view: 'workers', ...filters }),
    queryFn: () => source.workers(projectId, filters),
  });
}

export function useWorkerMutations() {
  const source = useAttendanceSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const settle = <T>(value: T) => {
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'attendance') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: WorkerInput) => settle(await source.createWorker(projectId, input)),
    }),
    update: useMutation({
      mutationFn: async (v: {
        worker: Worker;
        patch: Partial<WorkerInput> & { status?: Worker['status'] };
      }) => settle(await source.updateWorker(projectId, v.worker, v.patch)),
    }),
  };
}

/** Check in or out of the site from a gate link (a phone camera scan). Not optimistic: the answer is the record. */
export function useCheckInMutations() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const source = useMemo(
    () => (previewDataOnly ? checkInPreview : createCheckInApi(orgId)),
    [orgId],
  );
  const settle = <T>(value: T) => {
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'attendance') });
    return value;
  };
  return {
    checkIn: useMutation({
      mutationFn: async (gateCode: string) => settle(await source.checkIn(projectId, gateCode)),
    }),
    checkOut: useMutation({
      mutationFn: async (gateCode: string | null) =>
        settle(await source.checkOut(projectId, gateCode)),
    }),
  };
}
