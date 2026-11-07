import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
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
  /** Runs in the org's creation transaction, e.g. to enter the org in the console's tenant directory. */
  onOrgCreated?: (
    scope: TenantScope,
    org: { id: string; name: string; slug: string },
    entitlements: Entitlements,
  ) => Promise<void>;
}

export interface TenantAccess {
  principalType: 'member' | 'external';
  orgRole: TenantContext['orgRole'];
}

export function createOrgService({ database, access, defaultEntitlements, onOrgCreated }: OrgDeps) {
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
          await onOrgCreated?.(scope, org!, defaultEntitlements);
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

  /**
   * For someone with no access now: the project they were most recently removed from in the ordinary way since
   * `since`, if they hold no other access (X38). Null otherwise, so the API keeps answering 404 and never hints
   * at an org to someone removed for cause or long ago.
   */
  async function findRecentOrdinaryRemoval(
    orgId: string,
    userId: string,
    requestId: string,
    since: Date,
  ) {
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
        const rows = await tx
          .select({
            projectId: projectMembers.projectId,
            removedAt: projectMembers.removedAt,
            episode: projectMembers.accessEpisode,
            kind: projectMembers.removalKind,
            status: projectMembers.status,
          })
          .from(projectMembers)
          .where(eq(projectMembers.userId, userId))
          .orderBy(desc(projectMembers.removedAt));
        const latest = rows.find((r) => r.status === 'removed' && r.removedAt);
        if (!latest?.removedAt || latest.removedAt < since) return null;
        // Anything but an ordinary removal gives no grant and no hint (for_cause, wipe_now). One such
        // removal in the window anywhere in this organisation ends it, not just the latest.
        if (rows.some((r) => r.removedAt && r.removedAt >= since && r.kind !== 'ordinary'))
          return null;
        if (latest.kind !== 'ordinary') return null;
        // An organisation-level hold on the person (suspended membership) gives no grant either.
        const [held] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(and(eq(memberships.userId, userId), eq(memberships.status, 'suspended')))
          .limit(1);
        if (held) return null;
        return {
          projectId: latest.projectId,
          removedAt: latest.removedAt,
          episode: latest.episode,
        };
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

  return { createOrg, getOrg, resolveTenantAccess, findRecentOrdinaryRemoval, listMyOrgs };
}

export type OrgService = ReturnType<typeof createOrgService>;
