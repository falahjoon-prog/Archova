'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { useMemo } from 'react';
import { api, ensureCsrfToken } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createDataExportApi } from '../data/api';

const key = (orgId: string) => ['orgs', orgId, 'data-exports'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createDataExportApi(orgId), [orgId]);
}

/** Polls every 5 seconds while an export is being built, and not at all otherwise. */
export function useDataExports() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  return useQuery({
    queryKey: key(orgId),
    queryFn: () => source.list(),
    refetchInterval: (q) =>
      q.state.data?.data.some((e) => e.status === 'queued' || e.status === 'running')
        ? 5000
        : false,
  });
}

export function useCreateDataExport() {
  const { orgId } = useCurrentOrg();
  const source = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => source.create(),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(orgId) }),
  });
}

export function useDownloadDataExport() {
  const source = useApi();
  return useMutation({
    mutationFn: (exportId: string) => source.download(exportId),
    // The link is a short-lived signed URL that forces a download, so the page stays where it is.
    onSuccess: (d) => window.location.assign(d.url),
  });
}

export function useConfirmPassword() {
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async (body: { email: string; password: string }) => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/login', { body }));
    },
  });
}
