import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `meetings` (tool `meetings`). Minute-takers hold `standard` and edit; `admin` issues the
// minutes. Everyone else on the project reads, and outsiders only ever see what was issued to them (MTG-AC7).
export const MEETINGS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'meetings.meetings.read', scope: 'project', tool: 'meetings', level: 'read' },
  { key: 'meetings.meetings.write', scope: 'project', tool: 'meetings', level: 'standard' },
  { key: 'meetings.meetings.issue', scope: 'project', tool: 'meetings', level: 'admin' },
];
