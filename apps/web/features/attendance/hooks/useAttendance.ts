'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createAttendanceApi } from '../data/api';
import { attendancePreview, type AttendanceSource } from '../data/source';
import type { AttendanceSite, Gate, SiteInput } from '../lib/types';

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
