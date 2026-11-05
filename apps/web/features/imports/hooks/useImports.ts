'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  createImportsApi,
  type ImportJob,
  type ImportRow,
  type ImportRowStatus,
  type MappingInput,
  type StartImportInput,
} from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createImportsApi(orgId), [orgId]);
}

export function useImportJobs() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'imports'),
    queryFn: () => api.list(projectId),
  });
}

export function useImportJob(id: string | undefined) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'imports', id ?? ''),
    queryFn: () => api.get(projectId, id!),
    enabled: Boolean(id),
  });
}

export function useImportRows(
  id: string | undefined,
  status: ImportRowStatus | undefined,
  job: ImportJob | undefined,
) {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    // The rows change whenever the job's version does (parse, mapping), so the version is part of the key.
    queryKey: [
      ...queryKeys.toolItem(orgId, projectId, 'imports', id ?? ''),
      'rows',
      status ?? 'all',
      job?.version,
    ],
    queryFn: () => api.rows(projectId, id!, status),
    enabled: Boolean(id && job),
  });
}

export function useImportMutations() {
  const api = useApi();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  const settle = async (job: ImportJob) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'imports') });
    return job;
  };
  return {
    start: useMutation({
      mutationFn: async (input: StartImportInput) =>
        await settle(await api.start(projectId, input)),
    }),
    parse: useMutation({
      mutationFn: async (job: ImportJob) => await settle(await api.parse(projectId, job)),
    }),
    setMapping: useMutation({
      mutationFn: async (v: { job: ImportJob; mapping: MappingInput }) =>
        await settle(await api.setMapping(projectId, v.job, v.mapping)),
    }),
    cancel: useMutation({
      mutationFn: async (job: ImportJob) => await settle(await api.cancel(projectId, job)),
    }),
    suggest: useMutation({
      mutationFn: async (v: { job: ImportJob; rows: ImportRow[] }) =>
        await api.suggest(projectId, v.job, v.rows),
    }),
  };
}
