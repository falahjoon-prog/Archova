'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createAttendanceApi } from '../data/api';
import { attendancePreview, type AttendanceSource } from '../data/source';

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
