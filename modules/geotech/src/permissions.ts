import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `geotech` (tool `inspections`: the site-quality tool, as for `permits`). Anyone on the
// project may read the records; keeping them is the builder's admin.
export const GEOTECH_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'geotech.geotech.read', scope: 'project', tool: 'inspections', level: 'read' },
  { key: 'geotech.geotech.manage', scope: 'project', tool: 'inspections', level: 'admin' },
];
