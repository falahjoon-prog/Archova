import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `tasks`. Like conversations, tasks belong to the project team rather than one tool, so
// every active project member holds them (`tool: null`); outside users are refused in the application layer.
// Changing a task is further limited to its creator and assignee.
export const TASKS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'tasks.tasks.read', scope: 'project', tool: null, level: 'read' },
  { key: 'tasks.tasks.create', scope: 'project', tool: null, level: 'read' },
  { key: 'tasks.tasks.update', scope: 'project', tool: null, level: 'read' },
];
