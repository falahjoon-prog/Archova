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
  async function list(
    scope: TenantScope,
    projectId: string,
    opts: { limit: number; cursor?: string },
  ) {
    await deps.projects.get(scope, projectId);
    const after = decodeCursor<{ id: string }>(opts.cursor);
    const conditions: SQL[] = [
      eq(projectMembers.projectId, projectId),
      eq(projectMembers.status, 'active'),
    ];
    if (after) conditions.push(gt(projectMembers.id, after.id));
    const rows = await scope.tx
      .select()
      .from(projectMembers)
      .where(and(...conditions))
      .orderBy(asc(projectMembers.id))
      .limit(opts.limit + 1);
    const page = toPage(rows, opts.limit, (r) => ({ id: r.id }));
    const users = await deps.identity.getUsers(page.data.map((r) => r.userId));
    return {
      nextCursor: page.nextCursor,
      data: page.data.map((r) => ({
        ...r,
        name: users.get(r.userId)?.name ?? '',
        email: users.get(r.userId)?.email ?? '',
      })),
    };
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
    const id = uuidv7();
    const isExternal = !membership;
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

  return { list, add, getProjectMembership };
}

export type MemberService = ReturnType<typeof createMemberService>;
