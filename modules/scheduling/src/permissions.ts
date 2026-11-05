import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `scheduling` (tool `schedule`). Everyone on the project reads the programme and lookahead;
// planners and site managers hold `standard` and edit it; `admin` imports a programme revision or deletes one.
export const SCHEDULING_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'scheduling.schedule.read', scope: 'project', tool: 'schedule', level: 'read' },
  { key: 'scheduling.schedule.write', scope: 'project', tool: 'schedule', level: 'standard' },
  { key: 'scheduling.schedule.import', scope: 'project', tool: 'schedule', level: 'admin' },
];
