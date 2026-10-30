import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `correspondence` (tool `correspondence`, Sam 02 §2). Types belong to the org, so
// managing them is an org admin job; everyone in the org can read them to pick one. Outside users hold
// `standard` and can send to and answer the companies they deal with; which items they see is checked in the
// application layer. Closing or voiding needs `admin`.
export const CORRESPONDENCE_PERMISSIONS: readonly PermissionDefinition[] = [
  {
    key: 'correspondence.types.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member'],
  },
  { key: 'correspondence.types.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'correspondence.items.read', scope: 'project', tool: 'correspondence', level: 'read' },
  {
    key: 'correspondence.items.create',
    scope: 'project',
    tool: 'correspondence',
    level: 'standard',
  },
  { key: 'correspondence.items.send', scope: 'project', tool: 'correspondence', level: 'standard' },
  {
    key: 'correspondence.items.respond',
    scope: 'project',
    tool: 'correspondence',
    level: 'standard',
  },
  { key: 'correspondence.items.close', scope: 'project', tool: 'correspondence', level: 'admin' },
];
