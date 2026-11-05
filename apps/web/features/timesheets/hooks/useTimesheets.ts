'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createTimesheetsApi, type AddLine, type AdjustLine } from '../data/api';

function useTimesheetsApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createTimesheetsApi(orgId), [orgId]);
}

export function useTimesheets(projectId: string, from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useTimesheetsApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'timesheets', { from, to }),
    queryFn: () => source.list(projectId, from, to),
  });
}

export function useTimesheetMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useTimesheetsApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'timesheets') });
  const on = { onSuccess: refresh };
  return {
    generate: useMutation({
      mutationFn: (v: { from: string; to: string }) => source.generate(projectId, v.from, v.to),
      ...on,
    }),
    addLine: useMutation({
      mutationFn: (v: { id: string; body: AddLine }) => source.addLine(projectId, v.id, v.body),
      ...on,
    }),
    adjustLine: useMutation({
      mutationFn: (v: { id: string; lineId: string; body: AdjustLine }) =>
        source.adjustLine(projectId, v.id, v.lineId, v.body),
      ...on,
    }),
    submit: useMutation({ mutationFn: (id: string) => source.submit(projectId, id), ...on }),
    approve: useMutation({ mutationFn: (id: string) => source.approve(projectId, id), ...on }),
    reject: useMutation({
      mutationFn: (v: { id: string; reason: string }) => source.reject(projectId, v.id, v.reason),
      ...on,
    }),
    exportCsv: useMutation({
      mutationFn: (v: { from: string; to: string }) => source.exportCsv(projectId, v.from, v.to),
      ...on,
    }),
  };
}
