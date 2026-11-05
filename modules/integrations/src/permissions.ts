import type { PermissionDefinition } from '@archova/domain/permissions';

// Permission keys owned by `integrations`. Imports bring a whole register in from another system, and applying
// them creates records in other modules (each of which still checks its own permission), so staging and reading
// the staged rows is project admin work.
export const INTEGRATIONS_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'integrations.imports.read', scope: 'project', tool: 'project_admin', level: 'admin' },
  { key: 'integrations.imports.manage', scope: 'project', tool: 'project_admin', level: 'admin' },
  // Outbound webhooks send event notices to an address the org names, so owners and admins only.
  { key: 'integrations.webhooks.manage', scope: 'org', tool: null, level: 'admin' },
  // Xero and MYOB connections hold OAuth access to the org's books and decide what is pushed, so owners and admins only.
  { key: 'integrations.accounting.manage', scope: 'org', tool: null, level: 'admin' },
  // SharePoint and Drive connections hold access to the org's files, so owners and admins only.
  { key: 'integrations.folders.manage', scope: 'org', tool: null, level: 'admin' },
  // Linking a project's drawing set to a folder sends its drawings outside Archova, so project admins only.
  {
    key: 'integrations.folder_links.manage',
    scope: 'project',
    tool: 'project_admin',
    level: 'admin',
  },
];
