'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createMarketplaceApi } from '../data/api';

export function useCatalogue() {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createMarketplaceApi(orgId), [orgId]);
  return useQuery({
    queryKey: ['orgs', orgId, 'integrations', 'catalogue'],
    queryFn: () => source.catalogue(),
  });
}
