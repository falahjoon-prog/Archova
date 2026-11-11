import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `projectplan` (tool `project_plan`). Everyone with the tool reads the plan; `standard`
// shapes it and sets item status; only `admin` clears a hold point, so a hold is never lifted by whoever it stops.
export const PROJECTPLAN_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'projectplan.plan.read', scope: 'project', tool: 'project_plan', level: 'read' },
  { key: 'projectplan.plan.write', scope: 'project', tool: 'project_plan', level: 'standard' },
  { key: 'projectplan.holds.clear', scope: 'project', tool: 'project_plan', level: 'admin' },
];
