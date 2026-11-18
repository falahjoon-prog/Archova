import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `plant`. The fleet belongs to the organisation, not a project, so all three are
// org-scoped: staff (`member`) see the fleet and allocate machines to projects; the register, maintenance schedule
// and daily rates are for owners and admins.
export const PLANT_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'plant.assets.view', scope: 'org', tool: null, level: 'standard', orgRoles: ['member'] },
  {
    key: 'plant.allocations.manage',
    scope: 'org',
    tool: null,
    level: 'standard',
    orgRoles: ['member'],
  },
  { key: 'plant.assets.manage', scope: 'org', tool: null, level: 'admin' },
];
