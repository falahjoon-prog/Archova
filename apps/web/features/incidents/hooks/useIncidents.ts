'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createIncidentsApi } from '../data/api';
import { incidentsPreview, type IncidentSource } from '../data/source';
import type {
  ActionInput,
  ActionSource,
  ClassifyInput,
  CorrectiveStatus,
  IncidentAction,
  IncidentDetail,
  IncidentFilters,
  ReportInput,
} from '../lib/types';

function useSource(): IncidentSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? incidentsPreview : createIncidentsApi(orgId)), [orgId]);
}

export function useIncidentList(filters: IncidentFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'incidents', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useIncidentDetail(id: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'incidents', id),
    queryFn: () => source.get(projectId, id),
    enabled: id !== '',
  });
}

/** The corrective actions raised from one inspection or observation. Nothing is fetched until it is shown. */
export function useActionsFromSource(source: ActionSource) {
  const src = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'incidents', { fromSource: source }),
    queryFn: () => src.fromSource(projectId, source),
  });
}

export function useIncidentMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async (d: IncidentDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'incidents', d.incident.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'incidents') });
    return d;
  };
  return {
    report: useMutation({
      mutationFn: async (input: ReportInput) => settle(await source.report(projectId, input)),
    }),
    classify: useMutation({
      mutationFn: async (v: { detail: IncidentDetail; input: ClassifyInput }) =>
        settle(await source.classify(projectId, v.detail, v.input)),
    }),
    transition: useMutation({
      mutationFn: async (v: {
        detail: IncidentDetail;
        input: { action: IncidentAction; reason?: string };
      }) => settle(await source.transition(projectId, v.detail, v.input)),
    }),
    addAction: useMutation({
      mutationFn: async (v: { detail: IncidentDetail; input: ActionInput }) =>
        settle(await source.addAction(projectId, v.detail, v.input)),
    }),
    setActionStatus: useMutation({
      mutationFn: async (v: {
        detail: IncidentDetail;
        actionId: string;
        status: CorrectiveStatus;
      }) => settle(await source.setActionStatus(projectId, v.detail, v.actionId, v.status)),
    }),
  };
}
