'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createEnvironmentApi } from '../data/api';
import { environmentPreview, type EnvironmentSource } from '../data/source';
import type {
  CarbonEntry,
  CarbonInput,
  Condition,
  ConditionFilters,
  ConditionInput,
  DocketInput,
  DocumentInput,
  EnvironmentDocument,
  MonitoringPoint,
  Plan,
  PointInput,
  Reading,
  ReadingFilters,
  ReadingInput,
  RespondInput,
  PlanInput,
  TransitionInput,
  WasteDocket,
} from '../lib/types';

function useSource(): EnvironmentSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? environmentPreview : createEnvironmentApi(orgId)),
    [orgId],
  );
}

export function useEnvironmentSummary() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'summary' }),
    queryFn: () => source.summary(projectId),
  });
}

export function useConditions(filters: ConditionFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', {
      view: 'conditions',
      ...filters,
    }),
    queryFn: () => source.listConditions(projectId, filters),
  });
}

export function useConditionDetail(id: string | null) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'environment', id ?? ''),
    queryFn: () => source.getCondition(projectId, id!),
    enabled: id !== null,
  });
}

export function useEnvironmentDocuments() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'documents' }),
    queryFn: () => source.listDocuments(projectId),
  });
}

export function useMonitoringPoints() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'points' }),
    queryFn: () => source.listPoints(projectId),
  });
}

export function useReadings(filters: ReadingFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'readings', ...filters }),
    queryFn: () => source.listReadings(projectId, filters),
  });
}

export function useWaste() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const dockets = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'waste' }),
    queryFn: () => source.listDockets(projectId),
  });
  const summary = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'waste-summary' }),
    queryFn: () => source.wasteSummary(projectId),
  });
  return { dockets, summary };
}

export function useCarbon() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const entries = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'carbon' }),
    queryFn: () => source.listCarbon(projectId),
  });
  const summary = useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'environment', { view: 'carbon-summary' }),
    queryFn: () => source.carbonSummary(projectId),
  });
  return { entries, summary };
}

/** Status changes are seen by others and feed the summary, so none is optimistic. */
export function useEnvironmentMutations() {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  // Wait for the register to refetch so the next action never uses a stale version.
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'environment') });
    return value;
  };
  return {
    createCondition: useMutation({
      mutationFn: async (input: ConditionInput) =>
        await settle(await source.createCondition(projectId, input)),
    }),
    starterPack: useMutation({
      mutationFn: async () => await settle(await source.applyStarterPack(projectId)),
    }),
    transition: useMutation({
      mutationFn: async (v: { condition: Condition; input: TransitionInput }) =>
        await settle(await source.transition(projectId, v.condition, v.input)),
    }),
    createDocument: useMutation({
      mutationFn: async (input: DocumentInput) =>
        await settle(await source.createDocument(projectId, input)),
    }),
    deleteDocument: useMutation({
      mutationFn: async (d: EnvironmentDocument) =>
        await settle(await source.deleteDocument(projectId, d)),
    }),
    createPlan: useMutation({
      mutationFn: async (input: PlanInput) =>
        await settle(await source.createPlan(projectId, input)),
    }),
    approvePlan: useMutation({
      mutationFn: async (plan: Plan) => await settle(await source.approvePlan(projectId, plan)),
    }),
    createPoint: useMutation({
      mutationFn: async (input: PointInput) =>
        await settle(await source.createPoint(projectId, input)),
    }),
    logReading: useMutation({
      mutationFn: async (v: { point: MonitoringPoint; input: ReadingInput }) =>
        await settle(await source.logReading(projectId, v.point, v.input)),
    }),
    respond: useMutation({
      mutationFn: async (v: { reading: Reading; input: RespondInput }) =>
        await settle(await source.respond(projectId, v.reading, v.input)),
    }),
    createDocket: useMutation({
      mutationFn: async (input: DocketInput) =>
        await settle(await source.createDocket(projectId, input)),
    }),
    deleteDocket: useMutation({
      mutationFn: async (d: WasteDocket) => await settle(await source.deleteDocket(projectId, d)),
    }),
    createCarbon: useMutation({
      mutationFn: async (input: CarbonInput) =>
        await settle(await source.createCarbon(projectId, input)),
    }),
    deleteCarbon: useMutation({
      mutationFn: async (e: CarbonEntry) => await settle(await source.deleteCarbon(projectId, e)),
    }),
  };
}
