import { decodeId, encodeId } from '@archova/domain';
import {
  AppError,
  defineRoutes,
  etag,
  parseIfMatch,
  requirePrincipal,
  requireTenant,
  type Database,
} from '@archova/kernel';
import type { IdentityApi } from '@archova/mod-identity';
import type { SupportAccessPort } from '../application/support-access';
import type { CompanyService } from '../application/companies';
import type { KeyDateService } from '../application/key-dates';
import type { MemberService } from '../application/members';
import type { OrgService } from '../application/orgs';
import type { ProjectService } from '../application/projects';
import {
  toCompanyDto,
  toKeyDateChangeDto,
  toKeyDatesDto,
  toMembershipSummary,
  toOrgDto,
  toProjectDto,
  toProjectMemberDto,
} from './mappers';

export interface PlatformRouteDeps {
  database: Database;
  identity: Pick<IdentityApi, 'getUser' | 'getUsers'>;
  orgs: OrgService;
  projects: ProjectService;
  keyDates: KeyDateService;
  companies: CompanyService;
  members: MemberService;
  support: SupportAccessPort;
}

const projectUuid = (id: string) => {
  const uuid = decodeId('project', id);
  if (!uuid) throw new AppError('project.not_found');
  return uuid;
};

const decodeRef = (kind: 'company' | 'permissionTemplate', id: string) => {
  const uuid = decodeId(kind, id);
  if (!uuid)
    throw new AppError(kind === 'company' ? 'company.not_found' : 'permission_template.not_found');
  return uuid;
};

export function platformRoutes(d: PlatformRouteDeps) {
  const ro = { readOnly: true } as const;
  return defineRoutes({
    getMe: async (input) => {
      const principal = requirePrincipal(input);
      const user = await d.identity.getUser(principal.userId);
      if (!user) throw new AppError('auth.unauthenticated');
      const orgList = await d.orgs.listMyOrgs(principal.userId);
      return {
        status: 200,
        body: {
          user: {
            id: encodeId('user', user.id),
            email: user.email,
            name: user.name,
            locale: user.locale,
            timezone: user.timezone,
          },
          memberships: orgList.map(toMembershipSummary),
        },
      };
    },
    createOrg: async (input) => {
      const principal = requirePrincipal(input);
      const org = await d.orgs.createOrg(principal, input.body, input.requestId);
      return { status: 201, body: toOrgDto(org), headers: { etag: etag(org.version) } };
    },
    getOrg: async (input) => {
      const org = await d.database.withTenantTx(requireTenant(input), (s) => d.orgs.getOrg(s), ro);
      return { status: 200, body: toOrgDto(org), headers: { etag: etag(org.version) } };
    },
    listProjects: async (input) => {
      const page = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.projects.list(s, input.query),
        ro,
      );
      return {
        status: 200,
        body: { data: page.data.map(toProjectDto), nextCursor: page.nextCursor },
      };
    },
    createProject: async (input) => {
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.projects.create(s, input.body),
      );
      return { status: 201, body: toProjectDto(row), headers: { etag: etag(row.version) } };
    },
    getProject: async (input) => {
      const id = projectUuid(input.params.projectId);
      const row = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.projects.get(s, id),
        ro,
      );
      return { status: 200, body: toProjectDto(row), headers: { etag: etag(row.version) } };
    },
    updateProject: async (input) => {
      const id = projectUuid(input.params.projectId);
      const expected = parseIfMatch(input.headers['if-match']);
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.projects.update(s, id, expected, input.body),
      );
      return { status: 200, body: toProjectDto(row), headers: { etag: etag(row.version) } };
    },
    getKeyDates: async (input) => {
      const id = projectUuid(input.params.projectId);
      const k = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.keyDates.get(s, id),
        ro,
      );
      return { status: 200, body: toKeyDatesDto(k), headers: { etag: etag(k.version) } };
    },
    updateKeyDates: async (input) => {
      const id = projectUuid(input.params.projectId);
      const expected = parseIfMatch(input.headers['if-match']);
      const { sections, ...rest } = input.body;
      const k = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.keyDates.update(s, id, expected, { ...rest, ...(sections ? { sections } : {}) }),
      );
      return { status: 200, body: toKeyDatesDto(k), headers: { etag: etag(k.version) } };
    },
    listKeyDateChanges: async (input) => {
      const id = projectUuid(input.params.projectId);
      const rows = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.keyDates.changes(s, id),
        ro,
      );
      const users = await d.identity.getUsers(
        rows.map((r) => r.changedBy).filter((u): u is string => !!u),
      );
      const names = new Map([...users].map(([uid, u]) => [uid, u.name]));
      return { status: 200, body: { data: rows.map((r) => toKeyDateChangeDto(r, names)) } };
    },
    listProjectMembers: async (input) => {
      const id = projectUuid(input.params.projectId);
      const page = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.members.list(s, id, input.query),
        ro,
      );
      return {
        status: 200,
        body: { data: page.data.map(toProjectMemberDto), nextCursor: page.nextCursor },
      };
    },
    addProjectMember: async (input) => {
      const id = projectUuid(input.params.projectId);
      const body = {
        email: input.body.email,
        companyId: decodeRef('company', input.body.companyId),
        permissionTemplateId: decodeRef('permissionTemplate', input.body.permissionTemplateId),
      };
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.members.add(s, id, body),
      );
      return { status: 201, body: toProjectMemberDto(row) };
    },
    removeProjectMember: async (input) => {
      const id = projectUuid(input.params.projectId);
      const memberId = decodeId('projectMember', input.params.memberId);
      if (!memberId) throw new AppError('project_member.not_found');
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.members.remove(s, id, memberId, input.body),
      );
      return { status: 200, body: toProjectMemberDto(row) };
    },
    getSupportAccess: async (input) => {
      const tenant = requireTenant(input);
      const status = await d.database.withTenantTx(
        tenant,
        (s) => d.support.status(s.tx, s.ctx.orgId),
        ro,
      );
      return { status: 200, body: status };
    },
    grantSupportAccess: async (input) => {
      const tenant = requireTenant(input);
      const user = await d.identity.getUser(tenant.userId);
      const status = await d.database.withTenantTx(tenant, async (s) => {
        await d.support.grant(
          s.tx,
          s.ctx.orgId,
          { userId: tenant.userId, name: user?.name ?? 'An admin' },
          input.body,
        );
        return d.support.status(s.tx, s.ctx.orgId);
      });
      return { status: 200, body: status };
    },
    revokeSupportAccess: async (input) => {
      await d.database.withTenantTx(requireTenant(input), (s) =>
        d.support.revoke(s.tx, s.ctx.orgId),
      );
      return { status: 204 };
    },
    getSupportBanner: async (input) => {
      const banner = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.support.banner(s.tx, s.ctx.orgId),
        ro,
      );
      return { status: 200, body: banner };
    },
    listCompanies: async (input) => {
      const page = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.companies.list(s, input.query),
        ro,
      );
      return {
        status: 200,
        body: { data: page.data.map(toCompanyDto), nextCursor: page.nextCursor },
      };
    },
    createCompany: async (input) => {
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.companies.create(s, input.body),
      );
      return { status: 201, body: toCompanyDto(row), headers: { etag: etag(row.version) } };
    },
  });
}
