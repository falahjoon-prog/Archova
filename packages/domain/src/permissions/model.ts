// Permission model shared by backend `access` module and the clients (ADR-0006: `permissions` lives in `domain`).
// Behaviour: docs/security-licensing/02-roles-permissions.md. The server is always the authority;
// clients use `can()` only to hide or disable things.

export const ORG_ROLES = ['owner', 'admin', 'billing_admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const PERMISSION_LEVELS = ['none', 'read', 'standard', 'admin'] as const;
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/** Project tools (Sam 02 §2). Names match module names where a module exists. */
export const TOOLS = [
  'documents',
  'rfis',
  'submittals',
  'correspondence',
  'diary',
  'defects',
  'meetings',
  'inspections',
  'incidents',
  'budget',
  'commitments',
  'variations',
  'payment_claims',
  'directory',
  'workforce',
  'project_admin',
] as const;
export type Tool = (typeof TOOLS)[number];

export type ToolLevels = Partial<Record<Tool, PermissionLevel>>;

export function levelRank(level: PermissionLevel): number {
  return PERMISSION_LEVELS.indexOf(level);
}

export function atLeast(actual: PermissionLevel | undefined, required: PermissionLevel): boolean {
  return levelRank(actual ?? 'none') >= levelRank(required);
}

/**
 * A permission key `<module>.<resource>.<action>` (conventions.md) and what it needs.
 * `tool: null` means "any active project member" for project resources, or "org owner/admin" for org resources.
 */
export interface PermissionDefinition {
  key: string;
  scope: 'org' | 'project';
  tool: Tool | null;
  level: PermissionLevel;
  /** Org roles that hold this permission without a project template. */
  orgRoles?: readonly OrgRole[];
}

/** What the API returns from GET …/projects/{p}/permissions and what `access` caches per (user, project). */
export interface EffectivePermissions {
  orgRole: OrgRole | null;
  isExternal: boolean;
  projectId: string | null;
  companyId: string | null;
  isProjectMember: boolean;
  toolLevels: ToolLevels;
  granular: readonly string[];
  denied: readonly string[];
  companyScopedTools: readonly Tool[];
}

export const NO_PERMISSIONS: EffectivePermissions = {
  orgRole: null,
  isExternal: false,
  projectId: null,
  companyId: null,
  isProjectMember: false,
  toolLevels: {},
  granular: [],
  denied: [],
  companyScopedTools: [],
};

export type Decision = { allow: true } | { allow: false; reason: string };

const ADMIN_ROLES: readonly OrgRole[] = ['owner', 'admin'];

/**
 * Evaluates steps 5–6 of Sam 02 §5 (tool level, granular overrides) for one key.
 * Session, tenant and entitlement checks happen earlier in the API pipeline.
 * Default deny: an unknown key is a deny.
 */
export function evaluate(
  perms: EffectivePermissions,
  key: string,
  registry: ReadonlyMap<string, PermissionDefinition>,
): Decision {
  const def = registry.get(key);
  if (!def) return { allow: false, reason: 'unknown_permission' };
  if (perms.denied.includes(key)) return { allow: false, reason: 'explicit_deny' };

  // Org owners and admins can do everything in their org (Sam 02 §3). External collaborators never hold org roles.
  if (perms.orgRole && ADMIN_ROLES.includes(perms.orgRole)) return { allow: true };
  if (perms.orgRole && def.orgRoles?.includes(perms.orgRole)) return { allow: true };

  if (def.scope === 'org') return { allow: false, reason: 'org_role_required' };

  if (!perms.isProjectMember) return { allow: false, reason: 'not_project_member' };
  if (perms.granular.includes(key)) return { allow: true };
  if (def.tool === null) return { allow: true };
  if (atLeast(perms.toolLevels[def.tool], def.level)) return { allow: true };
  return { allow: false, reason: 'insufficient_level' };
}
