import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys the ai module owns (Sam 02). Org owners and admins hold every key; using Nova on a project
// needs the permission of the feature's own module (e.g. documents read for Ask Nova), checked by that feature.
export const AI_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: 'ai.settings.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member', 'billing_admin'],
  },
  { key: 'ai.settings.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'ai.usage.read', scope: 'org', tool: null, level: 'read', orgRoles: ['billing_admin'] },
];
