import { and, eq, inArray, isNull } from 'drizzle-orm';
import { slugify, uuidv7 } from '@archova/domain';
import type { CreateOrgRequest } from '@archova/contracts';
import {
  AppError,
  type Database,
  type Entitlements,
  type Principal,
  type TenantContext,
  type TenantScope,
  resolveTimeZone,
} from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import { companies, memberships, orgs, projectMembers } from '../infra/tables';
import { uniqueViolation } from './errors';

export interface OrgDeps {
  database: Database;
  access: AccessService;
  defaultEntitlements: Entitlements;
}

export interface TenantAccess {
  principalType: 'member' | 'external';
  orgRole: TenantContext['orgRole'];
}

export function createOrgService({ database, access, defaultEntitlements }: OrgDeps) {
  async function createOrg(principal: Principal, input: CreateOrgRequest, requestId: string) {
    const baseSlug = input.slug ?? (slugify(input.name).padEnd(3, '0') || 'org');
    for (let attempt = 0; attempt < 4; attempt++) {
      const slug =
        attempt === 0
          ? baseSlug
          : `${baseSlug.slice(0, 43)}-${Math.random().toString(36).slice(2, 6)}`;
      const orgId = uuidv7();
      const ctx: TenantContext = {
        orgId,
        userId: principal.userId,
        principalType: 'member',
        orgRole: 'owner',
        entitlements: defaultEntitlements,
        requestId,
      };
      try {
        return await database.withTenantTx(ctx, async (scope) => {
          const timezone = await resolveTimeZone(scope.tx, input.timezone ?? 'Australia/Sydney');
          const [org] = await scope.tx
            .insert(orgs)
            .values({
              id: orgId,
              name: input.name.trim(),
              legalName: input.legalName ?? null,
              abn: input.abn ?? null,
              slug,
              country: input.country ?? 'AU',
              timezone,
              kind: 'builder',
              createdBy: principal.userId,
              updatedBy: principal.userId,
            })
            .returning();
          await scope.tx.insert(memberships).values({
            id: uuidv7(),
            orgId,
            userId: principal.userId,
            role: 'owner',
            status: 'active',
            joinedAt: new Date(),
            createdBy: principal.userId,
            updatedBy: principal.userId,
          });
          await scope.tx.insert(companies).values({
            id: uuidv7(),
            orgId,
            name: input.legalName ?? input.name.trim(),
            abn: input.abn ?? null,
            type: 'builder',
            isOwnCompany: true,
            createdBy: principal.userId,
            updatedBy: principal.userId,
          });
          await access.seedDefaultTemplates(scope);
          scope.events.add({
            type: 'platform.org.created.v1',
            entityType: 'org',
            entityId: orgId,
            entityVersion: 1,
            data: { orgId, ownerUserId: principal.userId },
          });
          return org!;
        });
      } catch (e) {
        const constraint = uniqueViolation(e);
        if (constraint === 'orgs_slug_key') {
          if (input.slug)
            throw new AppError('org.slug_taken', 'That web address is taken. Try another.');
          continue;
        }
        throw e;
      }
    }
    throw new AppError('org.slug_taken', 'Could not find a free web address. Choose one.');
  }

  async function getOrg(scope: TenantScope) {
    const [org] = await scope.tx.select().from(orgs).where(eq(orgs.id, scope.ctx.orgId)).limit(1);
    if (!org || org.deletedAt) throw new AppError('org.not_found');
    return org;
  }

  /**
   * Who the caller is in this org: a member (with a role) or an external collaborator on at least one project.
   * Null means no access, which the API reports as 404 so an org's existence is never confirmed (backend 02 §1).
   */
  async function resolveTenantAccess(
    orgId: string,
    userId: string,
    requestId: string,
  ): Promise<TenantAccess | null> {
    const probe: TenantContext = {
      orgId,
      userId,
      principalType: 'member',
      orgRole: null,
      entitlements: defaultEntitlements,
      requestId,
    };
    return database.withTenantTx(
      probe,
      async ({ tx }) => {
        const [org] = await tx
          .select({ id: orgs.id })
          .from(orgs)
          .where(and(eq(orgs.id, orgId), isNull(orgs.deletedAt)))
          .limit(1);
        if (!org) return null;
        const [m] = await tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')))
          .limit(1);
        if (m) return { principalType: 'member' as const, orgRole: m.role };
        const [pm] = await tx
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(and(eq(projectMembers.userId, userId), eq(projectMembers.status, 'active')))
          .limit(1);
        return pm ? { principalType: 'external' as const, orgRole: null } : null;
      },
      { readOnly: true },
    );
  }

  /** Every org the user can open: memberships plus orgs where they are an external project member (ADR-0007). */
  async function listMyOrgs(userId: string) {
    return database.withSelfTx(userId, async (tx) => {
      const ms = await tx
        .select({ orgId: memberships.orgId, role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), eq(memberships.status, 'active')));
      const ext = await tx
        .selectDistinct({ orgId: projectMembers.orgId })
        .from(projectMembers)
        .where(and(eq(projectMembers.userId, userId), eq(projectMembers.status, 'active')));
      const roleByOrg = new Map<string, TenantContext['orgRole']>(ms.map((m) => [m.orgId, m.role]));
      for (const e of ext) if (!roleByOrg.has(e.orgId)) roleByOrg.set(e.orgId, null);
      if (roleByOrg.size === 0) return [];
      const rows = await tx
        .select({ id: orgs.id, name: orgs.name, slug: orgs.slug })
        .from(orgs)
        .where(and(inArray(orgs.id, [...roleByOrg.keys()]), isNull(orgs.deletedAt)))
        .orderBy(orgs.name);
      return rows.map((o) => ({ ...o, role: roleByOrg.get(o.id) ?? null }));
    });
  }

  return { createOrg, getOrg, resolveTenantAccess, listMyOrgs };
}

export type OrgService = ReturnType<typeof createOrgService>;
