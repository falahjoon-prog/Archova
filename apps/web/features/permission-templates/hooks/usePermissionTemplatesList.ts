'use client';

import { useQuery } from '@tanstack/react-query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createPermissionTemplatesApi } from '../data/api';

export function usePermissionTemplatesList() {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: ['orgs', orgId, 'permission-templates'],
    queryFn: () => createPermissionTemplatesApi(orgId).list(),
  });
}
