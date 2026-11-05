'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  createProgrammeApi,
  type CreateActivity,
  type CreateDependency,
  type ImportRequest,
  type ScheduleDetail,
  type UpdateActivity,
} from '../data/programme';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createProgrammeApi(orgId), [orgId]);
}

export function useSchedules() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'programme', {}),
    queryFn: () => source.list(projectId),
  });
}

export function useSchedule(scheduleId: string | null) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'programme', scheduleId ?? ''),
    queryFn: () => source.get(projectId, scheduleId!),
    enabled: scheduleId !== null,
  });
}

export function useScheduleLinks(scheduleId: string | null) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'programme', { links: scheduleId }),
    queryFn: () => source.listLinks(projectId, scheduleId!),
    enabled: scheduleId !== null,
  });
}

/** Where one RFI or submittal sits on the programme. Errors (no programme access) just mean nothing to show. */
export function useItemPlacements(kind: 'rfi' | 'submittal', targetId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'programme', { item: kind, targetId }),
    queryFn: () => source.placements(projectId, kind, targetId),
    retry: false,
  });
}

export function useLookahead(scheduleId: string | null, weeks: number) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'programme', { lookahead: scheduleId, weeks }),
    queryFn: () => source.lookahead(projectId, scheduleId!, weeks),
    enabled: scheduleId !== null,
  });
}

/** Every change returns the whole programme with float recalculated, so the cache takes it as the answer. */
export function useProgrammeMutations(scheduleId: string | null) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  const qc = useQueryClient();
  const all = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'programme') });
  const store = (d: ScheduleDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'programme', d.schedule.id), d);
    return all();
  };
  const id = () => {
    if (!scheduleId) throw new Error('No programme is open');
    return scheduleId;
  };
  return {
    create: useMutation({
      mutationFn: (name: string) => source.create(projectId, name),
      onSuccess: store,
    }),
    importFile: useMutation({
      mutationFn: (body: ImportRequest) => source.importFile(projectId, body),
      onSuccess: (r) => store(r.detail),
    }),
    remove: useMutation({
      mutationFn: (sid: string) => source.remove(projectId, sid),
      onSuccess: all,
    }),
    createActivity: useMutation({
      mutationFn: (body: CreateActivity) => source.createActivity(projectId, id(), body),
      onSuccess: store,
    }),
    updateActivity: useMutation({
      mutationFn: (v: { activityId: string; body: UpdateActivity }) =>
        source.updateActivity(projectId, id(), v.activityId, v.body),
      onSuccess: store,
    }),
    deleteActivity: useMutation({
      mutationFn: (activityId: string) => source.deleteActivity(projectId, id(), activityId),
      onSuccess: store,
    }),
    createDependency: useMutation({
      mutationFn: (body: CreateDependency) => source.createDependency(projectId, id(), body),
      onSuccess: store,
    }),
    createLink: useMutation({
      mutationFn: (v: { activityId: string; kind: 'rfi' | 'submittal'; targetId: string }) =>
        source.createLink(projectId, id(), v.activityId, { kind: v.kind, targetId: v.targetId }),
      onSuccess: all,
    }),
    deleteLink: useMutation({
      mutationFn: (linkId: string) => source.deleteLink(projectId, id(), linkId),
      onSuccess: all,
    }),
    deleteDependency: useMutation({
      mutationFn: (dependencyId: string) => source.deleteDependency(projectId, id(), dependencyId),
      onSuccess: store,
    }),
  };
}
