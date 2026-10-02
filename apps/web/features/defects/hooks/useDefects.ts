'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { defectsSource, type DefectFilters } from '../data/source';
import type { Defect, DefectInput, DefectStage } from '../lib/types';

export function useDefectList(filters: DefectFilters) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'defects', { ...filters }),
    queryFn: () => defectsSource.list(projectId, filters),
  });
}

export function useDefect(id: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'defects', id),
    queryFn: () => defectsSource.get(projectId, id),
  });
}

/** Status changes carry evidence and are seen by another company, so none is optimistic. */
export function useDefectMutations() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const actor = useActor();
  const qc = useQueryClient();
  const settle = (d: Defect | Defect[]) => {
    for (const x of Array.isArray(d) ? d : [d]) {
      qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'defects', x.id), x);
    }
    // Pins on drawings show defect status too.
    void qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'drawings') });
    return qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'defects') });
  };
  return {
    create: useMutation({
      mutationFn: (v: { input: DefectInput; aiSuggested: boolean }) =>
        defectsSource.create(projectId, v.input, actor, v.aiSuggested),
      onSuccess: settle,
    }),
    bulkAssign: useMutation({
      mutationFn: (v: {
        ids: string[];
        companyId?: string;
        dueDate?: string;
        stage?: DefectStage;
      }) => defectsSource.bulkAssign(projectId, v.ids, v, actor),
      onSuccess: settle,
    }),
    markReady: useMutation({
      mutationFn: (v: { id: string; note: string; photoNames: string[] }) =>
        defectsSource.markReady(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: (v: { id: string; note: string; photoNames: string[] }) =>
        defectsSource.close(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
    withReason: useMutation({
      mutationFn: (v: { id: string; action: 'reject' | 'dispute' | 'void'; reason: string }) =>
        defectsSource.withReason(projectId, v.id, v.action, v.reason, actor),
      onSuccess: settle,
    }),
    reassign: useMutation({
      mutationFn: (v: {
        id: string;
        companyId: string;
        userId: string | null;
        dueDate: string | null;
      }) => defectsSource.reassign(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
  };
}

export function useDefectNova() {
  const { projectId } = useCurrentProject();
  return {
    suggest: useMutation({
      mutationFn: (description: string) => defectsSource.novaSuggest(description),
    }),
    duplicates: useMutation({
      mutationFn: (v: { title: string; locationId: string | null; sheetId: string | null }) =>
        defectsSource.novaDuplicates(projectId, v),
    }),
  };
}
