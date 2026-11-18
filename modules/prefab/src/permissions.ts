import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `prefab` (tool `schedule`, the project programme). Anyone who can read the programme sees the
// units; standard programme users add units, move them through fabrication, shipping and install, and record QA checks.
export const PREFAB_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'prefab.units.view', scope: 'project', tool: 'schedule', level: 'read' },
  { key: 'prefab.units.write', scope: 'project', tool: 'schedule', level: 'standard' },
];
