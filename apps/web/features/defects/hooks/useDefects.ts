'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createDefectsApi } from '../data/api';
import {
  defectsSource as previewSource,
  type DefectFilters,
  type DefectsSource,
} from '../data/source';
import type { Defect, DefectInput, DefectStage } from '../lib/types';

/** The API once the defects endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useDefectsSource(): DefectsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createDefectsApi(orgId)), [orgId]);
}

export function useDefectList(filters: DefectFilters) {
  const defectsSource = useDefectsSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'defects', { ...filters }),
    queryFn: () => defectsSource.list(projectId, filters),
  });
}

export function useDefect(id: string) {
  const defectsSource = useDefectsSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'defects', id),
    queryFn: () => defectsSource.get(projectId, id),
  });
}

/** Status changes carry evidence and are seen by another company, so none is optimistic. */
export function useDefectMutations() {
  const defectsSource = useDefectsSource();
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
      mutationFn: (v: { input: DefectInput; aiSuggestionId: string | null }) =>
        defectsSource.create(projectId, v.input, actor, v.aiSuggestionId),
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
      mutationFn: (v: { id: string; note: string; photos: File[] }) =>
        defectsSource.markReady(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: (v: { id: string; note: string; photos: File[] }) =>
        defectsSource.close(projectId, v.id, v, actor),
      onSuccess: settle,
    }),
    withReason: useMutation({
      mutationFn: (v: {
        id: string;
        action: 'reject' | 'dispute' | 'void' | 'reopen';
        reason: string;
      }) => defectsSource.withReason(projectId, v.id, v.action, v.reason, actor),
      onSuccess: settle,
    }),
    issue: useMutation({
      mutationFn: (id: string) => defectsSource.issue(projectId, id, actor),
      onSuccess: settle,
    }),
    completePart: useMutation({
      mutationFn: (id: string) => defectsSource.completePart(projectId, id, actor),
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
  const defectsSource = useDefectsSource();
  const { projectId } = useCurrentProject();
  return {
    suggest: useMutation({
      mutationFn: (v: { description: string; photos: File[]; drawing: Defect['drawing'] }) =>
        defectsSource.novaSuggest(projectId, v),
    }),
    /** Records what the person did with a suggestion; failing to record never blocks the defect. */
    decide: useMutation({
      mutationFn: (v: { suggestionId: string; decision: 'accepted' | 'edited' | 'rejected' }) =>
        defectsSource.novaDecide(projectId, v.suggestionId, v.decision).catch(() => undefined),
    }),
    duplicates: useMutation({
      mutationFn: (v: { title: string; locationId: string | null; drawing: Defect['drawing'] }) =>
        defectsSource.novaDuplicates(projectId, v),
    }),
  };
}
