import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `plant`. The fleet belongs to the organisation, not a project, so all are
// org-scoped: staff (`member`) see the fleet, allocate machines to projects and keep the register and maintenance
// schedule; daily rates are for owners and admins.
export const PLANT_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'plant.assets.view', scope: 'org', tool: null, level: 'standard', orgRoles: ['member'] },
  {
    key: 'plant.allocations.manage',
    scope: 'org',
    tool: null,
    level: 'standard',
    orgRoles: ['member'],
  },
  // Staff keep the register and the maintenance schedule; daily rates are cost data for owners and admins.
  {
    key: 'plant.assets.manage',
    scope: 'org',
    tool: null,
    level: 'standard',
    orgRoles: ['member'],
  },
  { key: 'plant.rates.view', scope: 'org', tool: null, level: 'admin' },
];
