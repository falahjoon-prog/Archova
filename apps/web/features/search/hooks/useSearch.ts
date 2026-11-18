'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createSearchApi } from '../data/api';

/** Fewer than this many characters is not searched (the API returns nothing for it). */
export const MIN_QUERY = 2;

export function useSearch(q: string) {
  const { orgId } = useCurrentOrg();
  const api = useMemo(() => createSearchApi(orgId), [orgId]);
  const enabled = q.trim().length >= MIN_QUERY;
  return useQuery({
    queryKey: ['orgs', orgId, 'search', q.trim()],
    queryFn: () => api.search(q.trim()),
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
