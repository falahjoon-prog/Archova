import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `declarations` (tool `inspections`: the site-compliance tool, as for `insurance`). Anyone
// on the project may read the register; keeping it and chasing subcontractors is the builder's admin. Scheduling a claim for
// payment with a required declaration still missing is a separate, deliberate permission.
export const DECLARATIONS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'declarations.statements.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'declarations.statements.manage', scope: 'project', tool: 'inspections', level: 'admin' },
  {
    key: 'declarations.statements.override',
    scope: 'project',
    tool: 'inspections',
    level: 'admin',
  },
];
