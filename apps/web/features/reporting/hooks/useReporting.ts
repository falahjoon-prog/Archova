'use client';

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { queries } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createReportingApi } from '../data/api';
import type { AuditFilters, ReportConfig, ReportInput } from '../lib/types';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createReportingApi(orgId), [orgId]);
}

export function usePortfolio(includeClosed: boolean) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({
    queryKey: ['orgs', orgId, 'portfolio', { includeClosed }],
    queryFn: () => api.portfolio(includeClosed),
  });
}

const reportsKey = (orgId: string) => ['orgs', orgId, 'reports'] as const;

export function useReports() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({ queryKey: reportsKey(orgId), queryFn: () => api.reports() });
}

/** Rows for a definition that has not been saved; refreshes as the definition is edited. */
export function useReportPreview(config: ReportConfig) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({
    queryKey: ['orgs', orgId, 'reports', 'preview', config],
    queryFn: () => api.preview(config),
    placeholderData: keepPreviousData,
  });
}

export function useSaveReport() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string | null; input: ReportInput }) =>
      v.id ? api.update(v.id, v.input) : api.create(v.input),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportsKey(orgId) }),
  });
}

export function useDeleteReport() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: reportsKey(orgId) }),
  });
}

/** The projects the caller can see, to pick which ones a report covers. */
export function useProjectChoices() {
  const { orgId } = useCurrentOrg();
  return useQuery({
    ...queries.projects(orgId),
    select: (page) => page.data.map((p) => ({ id: p.id, name: p.name })),
  });
}

export function useReadinessPack() {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({ queryKey: ['orgs', orgId, 'readiness-pack'], queryFn: () => api.readiness() });
}

export function useReadinessPdf() {
  const api = useApi();
  return useMutation({ mutationFn: () => api.readinessPdf() });
}

/** The audit log, newest first, fifty lines at a time. */
export function useAuditLog(filters: AuditFilters) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ['orgs', orgId, 'audit-log', filters],
    queryFn: ({ pageParam }) => api.auditLog(filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
