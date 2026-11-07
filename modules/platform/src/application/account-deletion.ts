// Deleting your own account (the in-app deletion both app stores require; compliance/06 APP 11.2, 07).
// What goes: the person's profile, credentials, sessions and API tokens, their seat in every org and project.
// What stays: the records they made or signed. Those are retention-guarded business records (compliance/07) and
// keep pointing at the user id, which now reads "Deleted user".
// Sole owners can't just leave: an org that others still use needs a new owner first, and an org under a platform
// hold can't be closed. An owner who is the only person in an org closes it with the account.
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { encodeId } from '@archova/domain';
import {
  AppError,
  type Database,
  type Entitlements,
  type TenantContext,
  type TenantScope,
} from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import { memberships, orgs, projectMembers } from '../infra/tables';
import type { OrgService } from './orgs';

export interface AccountDeletionDeps {
  database: Database;
  orgs: Pick<OrgService, 'listMyOrgs'>;
  identity: Pick<IdentityApi, 'eraseAccount' | 'revokeOwnApiTokens'>;
  defaultEntitlements: Entitlements;
}

type OwnedOrg = { id: string; name: string };

export function createAccountDeletionService(deps: AccountDeletionDeps) {
  const { database } = deps;

  const probe = (
    orgId: string,
    userId: string,
    requestId: string,
    orgRole: TenantContext['orgRole'],
  ): TenantContext => ({
    orgId,
    userId,
    principalType: orgRole ? 'member' : 'external',
    orgRole,
    entitlements: deps.defaultEntitlements,
    requestId,
  });

  /** Who else is in the org: other active owners, and anyone else with a seat (members or project members). */
  async function othersIn(scope: TenantScope, userId: string) {
    const [owners] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(
        and(
          ne(memberships.userId, userId),
          eq(memberships.role, 'owner'),
          eq(memberships.status, 'active'),
        ),
      );
    const [people] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(ne(memberships.userId, userId), eq(memberships.status, 'active')));
    const [external] = await scope.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(and(ne(projectMembers.userId, userId), eq(projectMembers.status, 'active')));
    const held = await scope.tx.execute<{ n: number }>(
      sql`select count(*)::int as n from shared.platform_holds where released_at is null`,
    );
    return {
      owners: owners!.n,
      anyone: people!.n + external!.n,
      onHold: Number(held.rows[0]!.n) > 0,
    };
  }

  /**
   * Deletes the account. Throws `account.sole_owner` (409, with the orgs) when an org still has people and no other
   * owner, or `account.org_on_hold` (409) when closing the person's own empty org is blocked by a platform hold.
   * Repeating after a partial failure finishes the job.
   */
  async function deleteAccount(userId: string, requestId: string, ip: string | null) {
    const mine = (await deps.orgs.listMyOrgs(userId)).filter((o) => o.role !== null);

    const blocked: OwnedOrg[] = [];
    const held: OwnedOrg[] = [];
    const toClose = new Set<string>();
    for (const o of mine.filter((m) => m.role === 'owner')) {
      const others = await database.withTenantTx(
        probe(o.id, userId, requestId, 'owner'),
        (scope) => othersIn(scope, userId),
        { readOnly: true },
      );
      if (others.owners > 0) continue;
      if (others.anyone > 0) blocked.push({ id: o.id, name: o.name });
      else if (others.onHold) held.push({ id: o.id, name: o.name });
      else toClose.add(o.id);
    }
    if (blocked.length > 0)
      throw new AppError(
        'account.sole_owner',
        'Make someone else an owner of these organisations first.',
        undefined,
        { orgs: blocked.map((o) => ({ ...o, id: encodeId('org', o.id) })) },
      );
    if (held.length > 0)
      throw new AppError(
        'account.org_on_hold',
        "We can't close these organisations right now. Contact support.",
        undefined,
        { orgs: held.map((o) => ({ ...o, id: encodeId('org', o.id) })) },
      );

    const all = await database.withSelfTx(userId, (tx) =>
      tx
        .select({ orgId: memberships.orgId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.userId, userId)),
    );
    const orgRoles = new Map<string, TenantContext['orgRole']>(all.map((m) => [m.orgId, m.role]));
    for (const o of mine) if (!orgRoles.has(o.id)) orgRoles.set(o.id, null);

    for (const [orgId, role] of orgRoles) {
      const ctx = probe(orgId, userId, requestId, role);
      await database.withTenantTx(ctx, async (scope) => {
        const now = new Date();
        if (toClose.has(orgId)) {
          await scope.tx
            .update(orgs)
            .set({ deletedAt: now, updatedAt: now })
            .where(and(eq(orgs.id, orgId), isNull(orgs.deletedAt)));
          scope.events.add({
            type: 'platform.org.closed.v1',
            entityType: 'org',
            entityId: orgId,
            data: { orgId, reason: 'owner_account_deleted' },
          });
        }
        await scope.tx
          .update(memberships)
          .set({ status: 'suspended', updatedAt: now })
          .where(and(eq(memberships.userId, userId), eq(memberships.orgId, orgId)));
        const seats = await scope.tx
          .update(projectMembers)
          .set({
            status: 'removed',
            removedAt: now,
            removalKind: 'wipe_now',
            removalReason: 'Account deleted by the person',
            updatedAt: now,
            version: sql`${projectMembers.version} + 1`,
          })
          .where(and(eq(projectMembers.userId, userId), eq(projectMembers.status, 'active')))
          .returning();
        for (const seat of seats) {
          await scope.recordChange({
            module: 'platform',
            entityType: 'project_member',
            entityId: seat.id,
            op: 'upsert',
            version: seat.version,
            projectId: seat.projectId,
          });
          scope.events.add({
            type: 'platform.project_member.removed.v1',
            projectId: seat.projectId,
            entityType: 'project_member',
            entityId: seat.id,
            entityVersion: seat.version,
            data: { projectId: seat.projectId, userId, kind: 'wipe_now' },
          });
        }
      });
      await deps.identity.revokeOwnApiTokens(ctx, ip);
    }

    await deps.identity.eraseAccount(userId);
  }

  return { deleteAccount };
}

export type AccountDeletionService = ReturnType<typeof createAccountDeletionService>;
