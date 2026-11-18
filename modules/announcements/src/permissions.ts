import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `announcements`. Everyone on the project can read what was sent to them; posting needs
// standard access to the project directory (site and project managers); `manage` (directory admin) also sees every
// announcement's read receipts and can nudge for any of them. The author always sees their own receipts.
export const ANNOUNCEMENTS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'announcements.announcements.read', scope: 'project', tool: null, level: 'read' },
  {
    key: 'announcements.announcements.create',
    scope: 'project',
    tool: 'directory',
    level: 'standard',
  },
  {
    key: 'announcements.announcements.manage',
    scope: 'project',
    tool: 'directory',
    level: 'admin',
  },
];
