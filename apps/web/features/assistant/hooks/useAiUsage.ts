'use client';

import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';

/**
 * Nova credits this month against the org's allowance (`GET /v1/orgs/{orgId}/ai/usage`, ai/05 §6). Used only to
 * show the allowance state; the API is what actually stops interactive features at 100%.
 */
export function useAiUsage() {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: ['orgs', orgId, 'ai', 'usage'],
    queryFn: async () =>
      unwrap(await api.GET('/v1/orgs/{orgId}/ai/usage', { params: { path: { orgId } } })),
    staleTime: 60_000,
    retry: false,
  });
}
