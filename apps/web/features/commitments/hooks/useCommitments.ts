'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createCommitmentsApi } from '../data/api';

export function useCommitments(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createCommitmentsApi(orgId), [orgId]);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'commitments', {}),
    queryFn: () => source.list(projectId),
  });
}
