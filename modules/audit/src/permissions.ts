import type { PermissionDefinition } from '@archova/domain/permissions';

// No orgRoles: only org owners and admins (who hold every org permission) can read the security log (doc 07 §7).
export const AUDIT_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'audit.security.read', scope: 'org', tool: null, level: 'admin' },
];
