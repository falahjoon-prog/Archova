import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `bim` (tool `coordination`). Registering models is a team lead's job (`admin`);
// raising, commenting on and moving issues is `standard`, so consultants can coordinate their own clashes.
export const BIM_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'bim.models.read', scope: 'project', tool: 'coordination', level: 'read' },
  { key: 'bim.models.manage', scope: 'project', tool: 'coordination', level: 'admin' },
  { key: 'bim.issues.read', scope: 'project', tool: 'coordination', level: 'read' },
  { key: 'bim.issues.manage', scope: 'project', tool: 'coordination', level: 'standard' },
  { key: 'bim.captures.read', scope: 'project', tool: 'coordination', level: 'read' },
  { key: 'bim.captures.manage', scope: 'project', tool: 'coordination', level: 'standard' },
];
