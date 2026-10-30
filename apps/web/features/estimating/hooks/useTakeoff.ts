'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SheetSize } from '@archova/markup';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useActor } from '@/shared/providers/useActor';
import { useMemo } from 'react';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createTakeoffApi } from '../data/takeoff-api';
import { takeoffSource as previewSource, type TakeoffSource } from '../data/takeoff-source';
import type { NewMeasurement, TakeoffMeasurement } from '../lib/takeoff-types';

/** The API once the estimating endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useTakeoffSource(): TakeoffSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createTakeoffApi(orgId)), [orgId]);
}

export function useMeasurements(projectId: string, revisionIds: readonly string[]) {
  const takeoffSource = useTakeoffSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'takeoff-measurements', { revisionIds }),
    queryFn: () => takeoffSource.list(projectId, { revisionIds }),
    enabled: revisionIds.length > 0,
  });
}

export function useTakeoffMutations(projectId: string) {
  const takeoffSource = useTakeoffSource();
  const { orgId } = useCurrentOrg();
  const actor = useActor();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'takeoff-measurements') });
  return {
    save: useMutation({
      mutationFn: (input: {
        items: readonly NewMeasurement[];
        scale: string;
        scaleConfirmed: boolean;
        size: SheetSize;
      }) => takeoffSource.createMany(projectId, input, actor),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: {
        id: string;
        patch: Partial<Pick<TakeoffMeasurement, 'label' | 'trade' | 'packageId'>>;
      }) => takeoffSource.update(projectId, input.id, input.patch),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => takeoffSource.remove(projectId, id),
      onSuccess: invalidate,
    }),
    sendToPackage: useMutation({
      mutationFn: (input: { ids: readonly string[]; packageId: string }) =>
        takeoffSource.sendToPackage(projectId, input.ids, input.packageId),
      onSuccess: () =>
        Promise.all([
          invalidate(),
          qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'tender-packages') }),
        ]),
    }),
  };
}
