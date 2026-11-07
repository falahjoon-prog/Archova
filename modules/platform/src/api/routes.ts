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
import { CSRF_COOKIE, SESSION_COOKIE, type IdentityApi } from '@archova/mod-identity';
import type { AccountDeletionService } from '../application/account-deletion';
import type { CompanyService } from '../application/companies';
import type { KeyDateService } from '../application/key-dates';
import type { LocationService } from '../application/locations';
import type { MemberService } from '../application/members';
import type { OrgService } from '../application/orgs';
import type { ProjectService } from '../application/projects';
import {
  toCompanyDto,
  toKeyDateChangeDto,
  toKeyDatesDto,
  toLocationDto,
  toMembershipSummary,
  toOrgDto,
  toProjectDto,
  toProjectMemberDto,
} from './mappers';

/** Support access lives with the console's records; the org's own admin reads and changes it through these. */
export interface SupportAccessPort {
  list(
    orgId: string,
  ): Promise<{ grants: Array<{ projectIds: string[] | null }>; sessions: unknown[] }>;
  grant(
    orgId: string,
    by: { userId: string; name: string },
    input: { ticketRef: string; hours: number; projectIds?: string[] },
  ): Promise<{ projectIds: string[] | null }>;
  revoke(orgId: string, grantId: string): Promise<void>;
  banner(orgId: string): Promise<{ active: boolean; since: string | null }>;
  listStaffActions(orgId: string): Promise<unknown[]>;
  listReads(orgId: string): Promise<unknown[]>;
}

export interface PlatformRouteDeps {
  supportAccess?: SupportAccessPort;
  database: Database;
  identity: Pick<IdentityApi, 'getUser' | 'getUsers'>;
  orgs: OrgService;
  projects: ProjectService;
  keyDates: KeyDateService;
  locations: LocationService;
  companies: CompanyService;
  members: MemberService;
  accountDeletion: AccountDeletionService;
}

/** How recently the person must have signed in to delete their account. */
const STEP_UP_MS = 15 * 60_000;

/** Customers see public project ids, never the stored uuids. */
const withEncodedProjects = <G extends { projectIds: string[] | null }>(g: G) => ({
  ...g,
  projectIds: g.projectIds ? g.projectIds.map((id) => encodeId('project', id)) : null,
});

const projectUuid = (id: string) => {
  const uuid = decodeId('project', id);
  if (!uuid) throw new AppError('project.not_found');
  return uuid;
};

const locationUuid = (id: string | null | undefined) => {
  if (id == null) return null;
  const uuid = decodeId('location', id);
  if (!uuid) throw new AppError('location.not_found');
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
  const supportPort = () => {
    if (!d.supportAccess) throw new AppError('not_implemented', 'Support access is not set up.');
    return d.supportAccess;
  };
  /** Only an org owner or admin can see or change support access. */
  const requireOrgAdmin = (input: { tenant: Parameters<typeof requireTenant>[0]['tenant'] }) => {
    const t = requireTenant(input);
    if (t.orgRole !== 'owner' && t.orgRole !== 'admin')
      throw new AppError('access.denied', 'Only an org owner or admin can manage support access.');
    return t;
  };
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
    deleteMe: async (input) => {
      const principal = requirePrincipal(input);
      // A person deletes their own account, signed in to the app: never a token, and only after a recent sign-in.
      if (principal.apiToken)
        throw new AppError('api_token.not_allowed', 'Sign in as yourself to delete your account.');
      if (Date.now() - principal.authTime.getTime() > STEP_UP_MS)
        throw new AppError('auth.step_up_required', 'Sign in again to delete your account.');
      await d.accountDeletion.deleteAccount(principal.userId, input.requestId, input.ip);
      return { status: 204, clearCookies: [SESSION_COOKIE, CSRF_COOKIE] };
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
    getSupportAccess: async (input) => {
      const t = requireOrgAdmin(input);
      const view = await supportPort().list(t.orgId);
      return { status: 200, body: { ...view, grants: view.grants.map(withEncodedProjects) } };
    },
    createSupportAccessGrant: async (input) => {
      const t = requireOrgAdmin(input);
      const user = await d.identity.getUser(t.userId);
      // A grant may be limited to chosen projects; each must be a live project of this company.
      const wanted = [...new Set((input.body.projectIds ?? []).map(projectUuid))];
      if (wanted.length) {
        const found = await d.database.withTenantTx(
          t,
          (s) => d.projects.existingIds(s, wanted),
          ro,
        );
        if (wanted.some((id) => !found.has(id))) throw new AppError('project.not_found');
      }
      const grant = await supportPort().grant(
        t.orgId,
        { userId: t.userId, name: user?.name ?? 'An org admin' },
        {
          ticketRef: input.body.ticketRef,
          hours: input.body.hours,
          ...(wanted.length ? { projectIds: wanted } : {}),
        },
      );
      return { status: 201, body: withEncodedProjects(grant) };
    },
    listStaffActions: async (input) => {
      const t = requireOrgAdmin(input);
      return { status: 200, body: { items: await supportPort().listStaffActions(t.orgId) } };
    },
    listSupportReads: async (input) => {
      const t = requireOrgAdmin(input);
      return { status: 200, body: { items: await supportPort().listReads(t.orgId) } };
    },
    getSupportBanner: async (input) => {
      // Any signed-in user of the company, not only admins: the banner tells everyone who is looking.
      const t = requireTenant(input);
      return { status: 200, body: await supportPort().banner(t.orgId) };
    },
    revokeSupportAccessGrant: async (input) => {
      const t = requireOrgAdmin(input);
      await supportPort().revoke(t.orgId, input.params.grantId);
      return { status: 204 };
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
    listProjectLocations: async (input) => {
      const id = projectUuid(input.params.projectId);
      const rows = await d.database.withTenantTx(
        requireTenant(input),
        (s) =>
          d.locations.list(s, id, { includeArchived: input.query?.includeArchived === 'true' }),
        ro,
      );
      return { status: 200, body: { data: rows.map(toLocationDto) } };
    },
    createProjectLocation: async (input) => {
      const id = projectUuid(input.params.projectId);
      const { parentId, ...rest } = input.body;
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.locations.create(s, id, { ...rest, parentId: locationUuid(parentId) }),
      );
      return { status: 201, body: toLocationDto(row), headers: { etag: etag(row.version) } };
    },
    suggestProjectLocations: async (input) => {
      const id = projectUuid(input.params.projectId);
      const rows = await d.database.withTenantTx(
        requireTenant(input),
        (s) => d.locations.suggest(s, id, input.query.text),
        ro,
      );
      return {
        status: 200,
        body: {
          data: rows.map((r) => ({
            locationId: encodeId('location', r.locationId),
            path: r.path,
            reason: r.reason,
          })),
        },
      };
    },
    updateProjectLocation: async (input) => {
      const id = projectUuid(input.params.projectId);
      const locId = locationUuid(input.params.locationId)!;
      const expected = parseIfMatch(input.headers['if-match']);
      const { parentId, archived, ...rest } = input.body;
      const row = await d.database.withTenantTx(requireTenant(input), (s) =>
        d.locations.update(s, id, locId, expected, {
          ...rest,
          ...(parentId !== undefined ? { parentId: locationUuid(parentId) } : {}),
          ...(archived !== undefined ? { archived } : {}),
        }),
      );
      return { status: 200, body: toLocationDto(row), headers: { etag: etag(row.version) } };
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
