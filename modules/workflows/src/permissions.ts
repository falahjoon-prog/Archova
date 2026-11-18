import type { PermissionDefinition } from '@archova/domain/permissions';

// One org permission: who sets up approval chains. Owners and admins hold every org permission. Deciding a step is not a
// permission of its own: the step names its approvers, and the record's own permission (e.g. variations.decide) still applies.
export const WORKFLOWS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'workflows.definitions.manage', scope: 'org', tool: null, level: 'admin' },
];
