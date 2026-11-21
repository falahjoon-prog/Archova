'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { isLocalDate } from '@archova/time';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createEvidenceApi, type Range } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useMemo(
    () => ({ orgId, projectId, api: createEvidenceApi(orgId, projectId) }),
    [orgId, projectId],
  );
}

export const rangeIsValid = (r: Range) =>
  isLocalDate(r.from) && isLocalDate(r.to) && r.from <= r.to;

export function useEvidencePack(range: Range) {
  const { orgId, projectId, api } = useApi();
  return useQuery({
    queryKey: ['orgs', orgId, 'projects', projectId, 'safety-evidence-pack', range],
    queryFn: () => api.pack(range),
    enabled: rangeIsValid(range),
  });
}

export function useEvidencePdf() {
  const { api } = useApi();
  return useMutation({ mutationFn: (range: Range) => api.pdf(range) });
}
