import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `ownerportal` (tool `owner_portal`). The client holds `read` and, as a granular grant on
// the client template, `approvals.decide`; the project team writes at `standard`. Deciding needs `admin` so a team
// member cannot decide for the client by default (org owners and admins always can, see the evaluate() rule).
export const OWNERPORTAL_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'ownerportal.updates.read', scope: 'project', tool: 'owner_portal', level: 'read' },
  { key: 'ownerportal.updates.manage', scope: 'project', tool: 'owner_portal', level: 'standard' },
  { key: 'ownerportal.approvals.read', scope: 'project', tool: 'owner_portal', level: 'read' },
  {
    key: 'ownerportal.approvals.request',
    scope: 'project',
    tool: 'owner_portal',
    level: 'standard',
  },
  { key: 'ownerportal.approvals.decide', scope: 'project', tool: 'owner_portal', level: 'admin' },
  { key: 'ownerportal.capital.read', scope: 'project', tool: 'owner_portal', level: 'read' },
  { key: 'ownerportal.capital.manage', scope: 'project', tool: 'owner_portal', level: 'standard' },
];
