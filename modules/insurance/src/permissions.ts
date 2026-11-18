import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `insurance` (tool `inspections`: the site-compliance tool, as for `safety`). Anyone on the
// project may read the register; keeping it is the builder's admin.
export const INSURANCE_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'insurance.covers.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'insurance.covers.manage', scope: 'project', tool: 'inspections', level: 'admin' },
];
