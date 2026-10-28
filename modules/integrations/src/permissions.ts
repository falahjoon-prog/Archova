import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `integrations`. Imports bring a whole register in from another system, and applying
// them creates records in other modules (each of which still checks its own permission), so staging and reading
// the staged rows is project admin work.
export const INTEGRATIONS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'integrations.imports.read', scope: 'project', tool: 'project_admin', level: 'admin' },
  { key: 'integrations.imports.manage', scope: 'project', tool: 'project_admin', level: 'admin' },
];
