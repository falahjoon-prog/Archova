import type { PermissionDefinition } from '@archova/domain/permissions';

// One org permission. Org owners and admins hold every org permission, and no org role is listed here, so nobody else
// can start or download a full export: it contains everything the company holds.
export const EXPORTS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'exports.data.export', scope: 'org', tool: null, level: 'admin' },
];
