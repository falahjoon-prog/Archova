import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `sync`. Deciding on changes held after someone's access ended is project admin work; on
// top of this, accepting runs the change's own permission as the approving admin (X38).
export const SYNC_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'sync.late.review', scope: 'project', tool: 'project_admin', level: 'admin' },
];
