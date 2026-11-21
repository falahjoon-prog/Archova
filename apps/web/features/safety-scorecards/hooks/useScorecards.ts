'use client';

import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { listScorecards, previewScorecards } from '../data/api';

export function useScorecards() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'safety-scorecards', {}),
    queryFn: () =>
      previewDataOnly ? Promise.resolve(previewScorecards) : listScorecards(orgId, projectId),
    retry: false,
  });
}
