import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `environment` (tool `environment`, Sam 02 §2). Anyone with the tool can read the plan,
// register and documents; the site team keeps the register current; the person accountable for compliance
// (admin) signs conditions off, approves the plan, sets it up and sets monitoring limits. The site team logs readings
// and answers breaches.
export const ENVIRONMENT_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'environment.plan.read', scope: 'project', tool: 'environment', level: 'read' },
  { key: 'environment.plan.manage', scope: 'project', tool: 'environment', level: 'admin' },
  { key: 'environment.plan.approve', scope: 'project', tool: 'environment', level: 'admin' },
  { key: 'environment.conditions.read', scope: 'project', tool: 'environment', level: 'read' },
  {
    key: 'environment.conditions.manage',
    scope: 'project',
    tool: 'environment',
    level: 'standard',
  },
  { key: 'environment.conditions.signoff', scope: 'project', tool: 'environment', level: 'admin' },
  { key: 'environment.documents.read', scope: 'project', tool: 'environment', level: 'read' },
  { key: 'environment.documents.manage', scope: 'project', tool: 'environment', level: 'standard' },
  { key: 'environment.monitoring.read', scope: 'project', tool: 'environment', level: 'read' },
  { key: 'environment.monitoring.manage', scope: 'project', tool: 'environment', level: 'admin' },
  { key: 'environment.monitoring.log', scope: 'project', tool: 'environment', level: 'standard' },
  {
    key: 'environment.monitoring.respond',
    scope: 'project',
    tool: 'environment',
    level: 'standard',
  },
];
