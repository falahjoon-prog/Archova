import type { PermissionDefinition } from './model';

// Permission keys owned by the phase 0 modules. Feature modules add theirs in their own
// `permissions.ts`; the generator copies the full list into @archova/contracts for clients.
export const FOUNDATION_PERMISSIONS: readonly PermissionDefinition[] = [
  { key: 'platform.orgs.update', scope: 'org', tool: null, level: 'admin' },
  { key: 'platform.members.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'platform.projects.create', scope: 'org', tool: null, level: 'admin' },
  {
    key: 'platform.companies.read',
    scope: 'org',
    tool: null,
    level: 'read',
    orgRoles: ['member', 'billing_admin'],
  },
  { key: 'platform.companies.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'platform.support_access.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'access.templates.read', scope: 'org', tool: null, level: 'read', orgRoles: ['member'] },
  { key: 'access.templates.manage', scope: 'org', tool: null, level: 'admin' },
  { key: 'platform.projects.read', scope: 'project', tool: null, level: 'read' },
  { key: 'platform.projects.update', scope: 'project', tool: 'project_admin', level: 'admin' },
  { key: 'platform.project_members.read', scope: 'project', tool: 'directory', level: 'read' },
  { key: 'platform.project_members.manage', scope: 'project', tool: 'directory', level: 'admin' },
  { key: 'files.objects.upload', scope: 'project', tool: 'documents', level: 'standard' },
  { key: 'files.objects.read', scope: 'project', tool: 'documents', level: 'read' },
  { key: 'files.org_objects.upload', scope: 'org', tool: null, level: 'admin' },
];

export function buildRegistry(
  ...lists: ReadonlyArray<readonly PermissionDefinition[]>
): ReadonlyMap<string, PermissionDefinition> {
  const map = new Map<string, PermissionDefinition>();
  for (const list of lists) {
    for (const def of list) {
      if (map.has(def.key)) throw new Error(`Duplicate permission key ${def.key}`);
      if (!/^[a-z_]+\.[a-z_]+\.[a-z_]+$/.test(def.key)) {
        throw new Error(`Permission key must be <module>.<resource>.<action>: ${def.key}`);
      }
      map.set(def.key, def);
    }
  }
  return map;
}

export const FOUNDATION_REGISTRY = buildRegistry(FOUNDATION_PERMISSIONS);
