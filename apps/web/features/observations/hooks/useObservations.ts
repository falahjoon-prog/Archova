'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createObservationsApi } from '../data/api';
import { observationsPreview, type ObservationsSource } from '../data/source';
import type {
  Observation,
  ObservationFilters,
  ObservationInput,
  TransitionInput,
} from '../lib/types';

function useSource(): ObservationsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? observationsPreview : createObservationsApi(orgId)),
    [orgId],
  );
}

export function useObservations(filters: ObservationFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'observations', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

/** Status changes are seen by another company, so none is optimistic. */
export function useObservationMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the register to refetch so the next action never uses a stale version.
  const settle = async (value: Observation) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'observations') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: ObservationInput) =>
        await settle(await source.create(projectId, input)),
    }),
    transition: useMutation({
      mutationFn: async (v: { observation: Observation; input: TransitionInput }) =>
        await settle(await source.transition(projectId, v.observation, v.input)),
    }),
  };
}
