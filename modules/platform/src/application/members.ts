import { and, asc, eq, gt, type SQL } from 'drizzle-orm';
import { uuidv7 } from '@archova/domain';
import { AppError, decodeCursor, toPage, type TenantScope } from '@archova/kernel';
import type { AccessService, ProjectMembershipInfo } from '@archova/mod-access';
import type { IdentityApi } from '@archova/mod-identity';
import { memberships, projectMembers } from '../infra/tables';
import type { CompanyService } from './companies';
import type { ProjectService } from './projects';
import { uniqueViolation } from './errors';

export function createMemberService(deps: {
  identity: Pick<IdentityApi, 'findUserByEmail' | 'getUsers'>;
  access: AccessService;
  companies: CompanyService;
  projects: ProjectService;
}) {
  /**
   * Active members, optionally narrowed by `q` (name, email, title, trade or company name), company and trade. Names and
   * emails live in the identity module, so a search loads the project's members (at most 1000) and filters them here.
   */
  async function list(
    scope: TenantScope,
    projectId: string,
    opts: {
      limit: number;
      cursor?: string | undefined;
      q?: string | undefined;
      companyId?: string | undefined;
      trade?: string | undefined;
    },
  ) {
    await deps.projects.get(scope, projectId);
    const q = opts.q?.trim().toLowerCase();
    const trade = opts.trade?.trim().toLowerCase();
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.status, 'active'),
    ];
    if (opts.companyId) conditions.push(eq(projectMembers.companyId, opts.companyId));
    const filtered = Boolean(q || trade);
    if (after && !filtered) conditions.push(gt(projectMembers.id, after.id));
    const rows = await scope.tx
      .select()
      .from(projectMembers)
      .where(and(...conditions))
      .orderBy(asc(projectMembers.id))
      .limit(filtered ? 1000 : opts.limit + 1);
    const users = await deps.identity.getUsers(rows.map((r) => r.userId));
    const names = q
      ? await deps.companies.names(
          scope,
          rows.map((r) => r.companyId),
        )
      : new Map();
    let enriched = rows.map((r) => ({
      ...r,
      name: users.get(r.userId)?.name ?? '',
      email: users.get(r.userId)?.email ?? '',
    }));
    if (filtered) {
      enriched = enriched.filter(
        (m) =>
          (!trade || (m.trade ?? '').toLowerCase() === trade) &&
          (!q ||
            [m.name, m.email, m.jobTitle, m.trade, m.phone, names.get(m.companyId)].some((v) =>
              (v ?? '').toLowerCase().includes(q),
            )),
      );
      if (after) enriched = enriched.filter((m) => m.id > after.id);
    }
    const page = toPage(enriched, opts.limit, (r) => ({ id: r.id }));
    return page;
  }

  /** Changes the directory details kept for a member. Empty text clears a field. */
  async function update(
    scope: TenantScope,
    projectId: string,
    memberId: string,
    input: {
      phone?: string | null | undefined;
      jobTitle?: string | null | undefined;
      trade?: string | null | undefined;
    },
  ) {
    await deps.projects.get(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) throw new AppError('project_member.not_found', 'That person is not on this project.');
    const clean = (v: string | null | undefined, current: string | null) =>
      v === undefined ? current : v?.trim() || null;
    const [done] = await scope.tx
      .update(projectMembers)
      .set({
        phone: clean(input.phone, row.phone),
        jobTitle: clean(input.jobTitle, row.jobTitle),
        trade: clean(input.trade, row.trade),
        version: row.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(projectMembers.id, row.id))
      .returning();
    await scope.recordChange({
      module: 'platform',
      entityType: 'project_member',
      entityId: row.id,
      op: 'upsert',
      version: done!.version,
      projectId,
    });
    const users = await deps.identity.getUsers([row.userId]);
    return {
      ...done!,
      name: users.get(row.userId)?.name ?? '',
      email: users.get(row.userId)?.email ?? '',
    };
  }

  /** Active project members of one company, with the names and emails to write to them (notices, not lists). */
  async function contactsOfCompany(scope: TenantScope, projectId: string, companyId: string) {
    const rows = await scope.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.companyId, companyId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .orderBy(asc(projectMembers.id))
      .limit(50);
    const users = await deps.identity.getUsers(rows.map((r) => r.userId));
    return rows.flatMap((r) => {
      const u = users.get(r.userId);
      return u?.email ? [{ userId: r.userId, name: u.name, email: u.email }] : [];
    });
  }

  /** Adds an existing user. Invitations for people without an account come with the invite flow. */
  async function add(
    scope: TenantScope,
    projectId: string,
    input: { email: string; companyId: string; permissionTemplateId: string },
  ) {
    await deps.projects.get(scope, projectId);
    const user = await deps.identity.findUserByEmail(input.email);
    if (!user) {
      throw new AppError(
        'project_member.user_not_found',
        'No Archova account uses that email yet. Invitations are coming soon.',
      );
    }
    if (!(await deps.companies.exists(scope, input.companyId)))
      throw new AppError('company.not_found', 'Company not found in this org.');
    if (!(await deps.access.templateExists(scope, input.permissionTemplateId))) {
      throw new AppError(
        'permission_template.not_found',
        'Permission template not found in this org.',
      );
    }
    const [membership] = await scope.tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.userId, user.id), eq(memberships.status, 'active')))
      .limit(1);
    const isExternal = !membership;
    const [previous] = await scope.tx
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
      .limit(1);
    if (previous?.status === 'active') {
      throw new AppError(
        'project_member.already_exists',
        'That person is already on this project.',
      );
    }
    if (previous) {
      // Someone removed earlier is given access again: a new episode, so grants from the last one stop counting.
      const [row] = await scope.tx
        .update(projectMembers)
        .set({
          status: 'active',
          removedAt: null,
          removalKind: null,
          removalReason: null,
          accessEpisode: previous.accessEpisode + 1,
          companyId: input.companyId,
          permissionTemplateId: input.permissionTemplateId,
          isExternal,
          version: previous.version + 1,
          updatedAt: new Date(),
          updatedBy: scope.ctx.userId,
        })
        .where(eq(projectMembers.id, previous.id))
        .returning();
      await scope.recordChange({
        module: 'platform',
        entityType: 'project_member',
        entityId: previous.id,
        op: 'upsert',
        version: row!.version,
        projectId,
      });
      scope.events.add({
        type: 'platform.project_member.added.v1',
        projectId,
        entityType: 'project_member',
        entityId: previous.id,
        entityVersion: row!.version,
        data: {
          projectId,
          userId: user.id,
          companyId: input.companyId,
          permissionTemplateId: input.permissionTemplateId,
          isExternal,
        },
      });
      return { ...row!, name: user.name, email: user.email };
    }
    const id = uuidv7();
    try {
      const [row] = await scope.tx
        .insert(projectMembers)
        .values({
          id,
          orgId: scope.ctx.orgId,
          projectId,
          userId: user.id,
          companyId: input.companyId,
          permissionTemplateId: input.permissionTemplateId,
          isExternal,
          status: 'active',
          createdBy: scope.ctx.userId,
          updatedBy: scope.ctx.userId,
        })
        .returning();
      await scope.recordChange({
        module: 'platform',
        entityType: 'project_member',
        entityId: id,
        op: 'upsert',
        version: 1,
        projectId,
      });
      scope.events.add({
        type: 'platform.project_member.added.v1',
        projectId,
        entityType: 'project_member',
        entityId: id,
        entityVersion: 1,
        data: {
          projectId,
          userId: user.id,
          companyId: input.companyId,
          permissionTemplateId: input.permissionTemplateId,
          isExternal,
        },
      });
      return { ...row!, name: user.name, email: user.email };
    } catch (e) {
      if (uniqueViolation(e) === 'project_members_project_id_user_id_key') {
        throw new AppError(
          'project_member.already_exists',
          'That person is already on this project.',
        );
      }
      throw e;
    }
  }

  /**
   * Ends someone's access to the project. The kind is recorded for the drain rules (X38): `ordinary` lets their
   * phone send the work it already queued, `for_cause` and `wipe_now` do not. Nobody removes themselves.
   */
  async function remove(
    scope: TenantScope,
    projectId: string,
    memberId: string,
    input: { kind: 'ordinary' | 'for_cause' | 'wipe_now'; reason?: string | undefined },
  ) {
    await deps.projects.get(scope, projectId);
    const [row] = await scope.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.id, memberId),
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .for('update')
      .limit(1);
    if (!row) throw new AppError('project_member.not_found', 'That person is not on this project.');
    if (row.userId === scope.ctx.userId)
      throw new AppError('project_member.cannot_remove_self', 'You cannot remove yourself.');
    const [done] = await scope.tx
      .update(projectMembers)
      .set({
        status: 'removed',
        removedAt: new Date(),
        removalKind: input.kind,
        removalReason: input.reason?.trim() || null,
        version: row.version + 1,
        updatedAt: new Date(),
        updatedBy: scope.ctx.userId,
      })
      .where(eq(projectMembers.id, row.id))
      .returning();
    await scope.recordChange({
      module: 'platform',
      entityType: 'project_member',
      entityId: row.id,
      op: 'upsert',
      version: done!.version,
      projectId,
    });
    scope.events.add({
      type: 'platform.project_member.removed.v1',
      projectId,
      entityType: 'project_member',
      entityId: row.id,
      entityVersion: done!.version,
      data: { projectId, userId: row.userId, kind: input.kind },
    });
    const users = await deps.identity.getUsers([row.userId]);
    return {
      ...done!,
      name: users.get(row.userId)?.name ?? '',
      email: users.get(row.userId)?.email ?? '',
    };
  }

  /** Public query used by `access` to build effective permissions. */
  async function getProjectMembership(
    scope: TenantScope,
    projectId: string,
    userId: string,
  ): Promise<ProjectMembershipInfo | null> {
    const [row] = await scope.tx
      .select()
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, userId),
          eq(projectMembers.status, 'active'),
        ),
      )
      .limit(1);
    return row
      ? {
          id: row.id,
          companyId: row.companyId,
          permissionTemplateId: row.permissionTemplateId,
          isExternal: row.isExternal,
        }
      : null;
  }

  /** How someone's access to a project stands, active or ended (the drain grant reads this, X38). */
  async function getProjectAccessState(scope: TenantScope, projectId: string, userId: string) {
    const [row] = await scope.tx
      .select({
        status: projectMembers.status,
        kind: projectMembers.removalKind,
        removedAt: projectMembers.removedAt,
        episode: projectMembers.accessEpisode,
      })
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
      .limit(1);
    if (!row) return null;
    // An organisation-level hold (suspended membership) is not an ordinary removal; the drain grant fails closed.
    const [hold] = await scope.tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, scope.ctx.orgId),
          eq(memberships.userId, userId),
          eq(memberships.status, 'suspended'),
        ),
      )
      .limit(1);
    return { ...row, held: Boolean(hold) };
  }

  return {
    list,
    update,
    add,
    remove,
    getProjectMembership,
    getProjectAccessState,
    contactsOfCompany,
  };
}

export type MemberService = ReturnType<typeof createMemberService>;
