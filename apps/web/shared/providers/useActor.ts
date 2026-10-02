'use client';

import { useCurrentOrg } from './CurrentOrgProvider';
import { useCurrentProject } from './CurrentProjectProvider';

/** The signed-in person acting on a project record: id, name and their company on the project. */
export function useActor() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  return { id: org.user.id, name: org.user.name, companyId: project.companyId };
}
