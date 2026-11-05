import { and, eq, inArray } from 'drizzle-orm';
import { AppError, defineModule, type Entitlements, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { IdentityApi } from '@archova/mod-identity';
import { createCompanyService } from './application/companies';
import { createKeyDateService } from './application/key-dates';
import { createMemberService } from './application/members';
import { createOrgService, type OrgDeps } from './application/orgs';
import { createProjectService } from './application/projects';
import { memberships, projects as projectsTable } from './infra/tables';
import { platformRoutes, type SupportAccessPort } from './api/routes';

export function createPlatformModule(
  services: KernelServices,
  deps: {
    identity: Pick<IdentityApi, 'getUser' | 'getUsers' | 'findUserByEmail'>;
    /** Resolved lazily: access and platform depend on each other's public interfaces. */
    access: () => AccessService;
    defaultEntitlements: Entitlements;
    onOrgCreated?: OrgDeps['onOrgCreated'];
    supportAccess?: SupportAccessPort;
    /** True when this staff member holds an open support session inside an unrevoked grant for the org. */
    hasOpenSupportSession?: (orgId: string, staffId: string) => Promise<boolean>;
  },
) {
  const access = new Proxy({} as AccessService, {
    get: (_t, prop) => deps.access()[prop as keyof AccessService],
  });
  const orgs = createOrgService({
    database: services.database,
    access,
    defaultEntitlements: deps.defaultEntitlements,
    ...(deps.onOrgCreated ? { onOrgCreated: deps.onOrgCreated } : {}),
  });
  const projects = createProjectService(access);
  const keyDates = createKeyDateService({ projects });
  const companies = createCompanyService();
  const members = createMemberService({ identity: deps.identity, access, companies, projects });
  return {
    definition: defineModule({ name: 'platform' }),
    routes: platformRoutes({
      database: services.database,
      identity: deps.identity,
      orgs,
      projects,
      keyDates,
      companies,
      members,
      ...(deps.supportAccess ? { supportAccess: deps.supportAccess } : {}),
    }),
    api: {
      resolveTenantAccess: orgs.resolveTenantAccess,
      getProjectMembership: members.getProjectMembership,
      getProjectAccessState: members.getProjectAccessState,
      contactsOfCompany: members.contactsOfCompany,
      getProject: projects.get,
      /** A page of the projects the caller can see (org admins: all). Used by `reporting` for the portfolio. */
      listProjects: projects.list,
      getOrg: orgs.getOrg,
      /** Project names for an open support session; read-only and org-wide, never a member's view (Sam 12 §4a). */
      /** True when the project exists in the org. Used by staff to check a legal hold names a real project. */
      projectInOrg: async (orgId: string, projectId: string) =>
        services.database.withTenantTx(
          {
            orgId,
            userId: '00000000-0000-0000-0000-000000000000',
            principalType: 'support',
            orgRole: null,
            entitlements: { plan: 'support', state: 'read_only', modules: [], limits: {} },
            requestId: 'project-in-org',
          },
          async (scope) =>
            (
              await scope.tx
                .select({ id: projectsTable.id })
                .from(projectsTable)
                .where(eq(projectsTable.id, projectId))
                .limit(1)
            ).length > 0,
          { readOnly: true },
        ),
      listProjectsForSupport: async (
        orgId: string,
        staffId: string,
        projectIds: string[] | null,
      ) => {
        // Checked here as well as by the caller, so this read cannot be reached without a live session.
        if (!deps.hasOpenSupportSession || !(await deps.hasOpenSupportSession(orgId, staffId)))
          throw new AppError('backoffice.support_no_session', 'There is no open support session.');
        return services.database.withTenantTx(
          {
            orgId,
            userId: staffId,
            principalType: 'support',
            orgRole: null,
            entitlements: { plan: 'support', state: 'read_only', modules: [], limits: {} },
            requestId: 'support',
          },
          (scope) => projects.listForSupport(scope, projectIds),
          { readOnly: true },
        );
      },
      /** Active owners and admins with their emails, for the notice sent when a support session opens. */
      orgAdminContacts: async (orgId: string) => {
        const ids = await services.database.withTenantTx(
          {
            orgId,
            userId: orgId,
            principalType: 'support',
            orgRole: null,
            entitlements: { plan: 'support', state: 'read_only', modules: [], limits: {} },
            requestId: 'support-notice',
          },
          async (scope) =>
            (
              await scope.tx
                .select({ userId: memberships.userId })
                .from(memberships)
                .where(
                  and(
                    eq(memberships.status, 'active'),
                    inArray(memberships.role, ['owner', 'admin']),
                  ),
                )
            ).map((r) => r.userId),
          { readOnly: true },
        );
        const users = await deps.identity.getUsers(ids);
        return [...users.values()].map((u) => ({ email: u.email, name: u.name }));
      },
      companyExists: companies.exists,
      companyIdentity: companies.identity,
      projectCompanies: companies.onProject,
      projectCompaniesWithTrades: companies.onProjectWithTrades,
    },
  };
}

export type PlatformModule = ReturnType<typeof createPlatformModule>;
export type PlatformApi = PlatformModule['api'];
