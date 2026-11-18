'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createHazardSignalsApi } from '../data/api';
import { hazardSignalsPreview, type HazardSignalSource } from '../data/source';
import type { SignalStatus } from '../lib/types';

function useSource(): HazardSignalSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? hazardSignalsPreview : createHazardSignalsApi(orgId)),
    [orgId],
  );
}

// Signals are Nova output kept beside the incidents, so they share the incidents key space and stay apart from the
// register by the `view` filter.
const keyFor = (orgId: string, projectId: string, filters: object) =>
  queryKeys.toolList(orgId, projectId, 'incidents', { view: 'hazard-signals', ...filters });

export function useHazardSignals(status?: SignalStatus) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: keyFor(orgId, projectId, { status: status ?? 'all' }),
    queryFn: () => source.list(projectId, status),
  });
}

export function useHazardPatterns(days: number) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: keyFor(orgId, projectId, { patterns: days }),
    queryFn: () => source.patterns(projectId, days),
  });
}

export function useHazardMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'incidents') });
  return {
    scan: useMutation({
      mutationFn: (v: { photo: File; note: string }) => source.scan(projectId, v),
      onSuccess: refresh,
    }),
    review: useMutation({
      mutationFn: (v: { id: string; decision: 'confirmed' | 'dismissed'; note?: string }) =>
        source.review(projectId, v.id, {
          decision: v.decision,
          ...(v.note ? { note: v.note } : {}),
        }),
      onSuccess: refresh,
    }),
  };
}
