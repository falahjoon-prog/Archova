import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `search`. Searching spans projects, so it is an org permission held by staff (members);
// external users never hold an org role. Each project's rows are then narrowed by that project's own tool permission
// (rfis.rfis.read and so on) inside the tool module, so search never shows what a person could not open.
export const SEARCH_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'search.global.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
];
