import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `permits` (tool `inspections`: the site-compliance tool, as for `safety`). Anyone on the
// project may read the register; keeping it is the builder's admin.
export const PERMITS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'permits.permits.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'permits.permits.manage', scope: 'project', tool: 'inspections', level: 'admin' },
];
