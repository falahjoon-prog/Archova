'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createInspectionsApi } from '../data/api';
import { inspectionsPreview, type InspectionsSource } from '../data/source';
import type {
  AnswerInput,
  InspectionDetail,
  InspectionFilters,
  InspectionInput,
  TemplateInput,
} from '../lib/types';

function useSource(): InspectionsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(
    () => (previewDataOnly ? inspectionsPreview : createInspectionsApi(orgId)),
    [orgId],
  );
}

function useScope() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return { orgId, projectId };
}

export function useTemplates() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'inspections', { view: 'templates' }),
    queryFn: () => source.templates(projectId),
  });
}

export function useInspections(filters: InspectionFilters) {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'inspections', { view: 'runs', ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useInspection(id: string) {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'inspections', id),
    queryFn: () => source.get(projectId, id),
    enabled: id !== '',
  });
}

export function useTemplateMutations() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  const qc = useQueryClient();
  const settle = async <T>(value: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'inspections') });
    return value;
  };
  return {
    create: useMutation({
      mutationFn: async (input: TemplateInput) =>
        settle(await source.createTemplate(projectId, input)),
    }),
    publish: useMutation({
      mutationFn: async (id: string) => settle(await source.publishTemplate(projectId, id)),
    }),
    newVersion: useMutation({
      mutationFn: async (id: string) => settle(await source.newVersion(projectId, id)),
    }),
  };
}

export function useInspectionMutations() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never uses a stale version.
  const settle = async (d: InspectionDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'inspections', d.inspection.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'inspections') });
    return d;
  };
  return {
    start: useMutation({
      mutationFn: async (input: InspectionInput) => settle(await source.start(projectId, input)),
    }),
    record: useMutation({
      mutationFn: async (v: { id: string; answers: AnswerInput[] }) =>
        settle(await source.record(projectId, v.id, v.answers)),
    }),
    submit: useMutation({
      mutationFn: async (v: { detail: InspectionDetail; signedByName: string }) =>
        settle(await source.submit(projectId, v.detail, v.signedByName)),
    }),
    close: useMutation({
      mutationFn: async (detail: InspectionDetail) => settle(await source.close(projectId, detail)),
    }),
  };
}
