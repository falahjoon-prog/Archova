'use client';

import { atLeast } from '@archova/domain/permissions';
import { useProjectPermissions } from '@/features/projects';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';

/** Commercial team: org owners and admins, or commitments admin on the project. The API enforces it too. */
export function useCanReviewContracts(): boolean {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId).data;
  return (
    perms?.orgRole === 'owner' ||
    perms?.orgRole === 'admin' ||
    atLeast(perms?.toolLevels.commitments, 'admin')
  );
}
