import { and, eq, isNull } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import {
  DEFAULT_PERMISSION_TEMPLATES,
  NO_PERMISSIONS,
  evaluate,
  type EffectivePermissions,
  type PermissionDefinition,
} from '@archova/domain/permissions';
import { AppError, type TenantScope } from '@archova/kernel';
import { permissionTemplates, projectMemberOverrides } from '../infra/tables';

/** What `access` needs to know about a project member. Supplied by `platform` (no cross-module SQL). */
export interface ProjectMembershipInfo {
  id: string;
  companyId: string;
  permissionTemplateId: string;
  isExternal: boolean;
}

export type ProjectMembershipLookup = (
  scope: TenantScope,
  projectId: string,
  userId: string,
) => Promise<ProjectMembershipInfo | null>;

export interface AccessDeps {
  registry: ReadonlyMap<string, PermissionDefinition>;
  lookupProjectMember: ProjectMembershipLookup;
}

/**
 * Permission engine (Sam 02 §5, backend 02 §4). Steps 1–3 (session, tenant, entitlement) run in the API
 * pipeline; this evaluates org role, tool level and granular overrides. Company scoping and item privacy
 * are applied in SQL by `listFilter` once feature modules carry those columns.
 * Effective permissions are computed per call for now; the Redis cache (`t:{org}:perm:{user}:{project}:{v}`)
 * lands with `access.cache_versions`.
 */
export function createAccessService({ registry, lookupProjectMember }: AccessDeps) {
  async function effectivePermissions(
    scope: TenantScope,
    projectId: string | null,
    /** Another person's permissions, from their project template only (their org role isn't known here). */
    otherUserId?: string,
  ): Promise<EffectivePermissions> {
    const base: EffectivePermissions = {
      ...NO_PERMISSIONS,
      orgRole: otherUserId ? null : scope.ctx.orgRole,
      isExternal: otherUserId ? true : scope.ctx.principalType === 'external',
      projectId,
    };
    if (!projectId) return base;
    const member = await lookupProjectMember(scope, projectId, otherUserId ?? scope.ctx.userId);
    if (!member) return base;
    const [template] = await scope.tx
      .select()
      .from(permissionTemplates)
      .where(
        and(
          eq(permissionTemplates.id, member.permissionTemplateId),
          isNull(permissionTemplates.deletedAt),
        ),
      )
      .limit(1);
    const overrides = await scope.tx
      .select()
      .from(projectMemberOverrides)
      .where(eq(projectMemberOverrides.projectMemberId, member.id));
    return {
      ...base,
      companyId: member.companyId,
      isExternal: member.isExternal,
      isProjectMember: true,
      toolLevels: template?.toolLevels ?? {},
      granular: [
        ...(template?.granular ?? []),
        ...overrides.filter((o) => o.effect === 'grant').map((o) => o.permissionKey),
      ],
      denied: overrides.filter((o) => o.effect === 'deny').map((o) => o.permissionKey),
      companyScopedTools: template?.companyScopedTools ?? [],
    };
  }

  /** Throws 403 `access.denied` unless the caller holds `key`. Default deny. */
  async function assert(
    scope: TenantScope,
    key: string,
    resource: { projectId?: string | null } = {},
  ): Promise<EffectivePermissions> {
    const perms = await effectivePermissions(scope, resource.projectId ?? null);
    const decision = evaluate(perms, key, registry);
    if (!decision.allow) {
      throw new AppError('access.denied', "You don't have permission to do that.", undefined, {
        permission: key,
        reason: decision.reason,
      });
    }
    return perms;
  }

  async function can(
    scope: TenantScope,
    key: string,
    resource: { projectId?: string | null } = {},
  ) {
    const perms = await effectivePermissions(scope, resource.projectId ?? null);
    return evaluate(perms, key, registry).allow;
  }

  /** Whether another project member holds `key` on the project, by their template and overrides. */
  async function canUser(scope: TenantScope, userId: string, key: string, projectId: string) {
    const perms = await effectivePermissions(scope, projectId, userId);
    return evaluate(perms, key, registry).allow;
  }

  /** Seeds the default templates (Sam 02 §4) into a new org. Returns template ids by key. */
  async function seedDefaultTemplates(scope: TenantScope): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    const rows = DEFAULT_PERMISSION_TEMPLATES.map((t) => {
      const id = uuidv7();
      ids.set(t.key, id);
      return {
        id,
        orgId: scope.ctx.orgId,
        key: t.key,
        name: t.name,
        description: t.description,
        isSeeded: true,
        toolLevels: t.toolLevels,
        granular: [...t.granular],
        companyScopedTools: [...t.companyScopedTools],
        createdBy: scope.ctx.userId,
        updatedBy: scope.ctx.userId,
      };
    });
    await scope.tx.insert(permissionTemplates).values(rows);
    return ids;
  }

  async function listTemplates(scope: TenantScope) {
    return scope.tx
      .select()
      .from(permissionTemplates)
      .where(isNull(permissionTemplates.deletedAt))
      .orderBy(permissionTemplates.id);
  }

  async function templateExists(scope: TenantScope, id: string): Promise<boolean> {
    const [row] = await scope.tx
      .select({ id: permissionTemplates.id })
      .from(permissionTemplates)
      .where(and(eq(permissionTemplates.id, id), isNull(permissionTemplates.deletedAt)))
      .limit(1);
    return Boolean(row);
  }

  async function templateIdByKey(scope: TenantScope, key: string): Promise<string | null> {
    const [row] = await scope.tx
      .select({ id: permissionTemplates.id })
      .from(permissionTemplates)
      .where(and(eq(permissionTemplates.key, key), isNull(permissionTemplates.deletedAt)))
      .limit(1);
    return row?.id ?? null;
  }

  return {
    effectivePermissions,
    assert,
    can,
    canUser,
    seedDefaultTemplates,
    listTemplates,
    templateExists,
    templateIdByKey,
  };
}

export type AccessService = ReturnType<typeof createAccessService>;
