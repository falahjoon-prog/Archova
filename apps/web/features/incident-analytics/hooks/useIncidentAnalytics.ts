'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createIncidentAnalyticsApi } from '../data/api';
import type { AnalyticsFilters } from '../lib/types';

export function useIncidentAnalytics(filters: AnalyticsFilters) {
  const { orgId } = useCurrentOrg();
  const api = useMemo(() => createIncidentAnalyticsApi(orgId), [orgId]);
  return useQuery({
    queryKey: ['orgs', orgId, 'incident-analytics', filters],
    queryFn: () => api.get(filters),
    placeholderData: keepPreviousData,
  });
}
