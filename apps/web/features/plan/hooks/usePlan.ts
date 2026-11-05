'use client';

import { useQuery } from '@tanstack/react-query';
import { queries } from '@/shared/lib/api';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';

export function usePlan() {
  const { orgId } = useCurrentOrg();
  return useQuery(queries.entitlements(orgId));
}
