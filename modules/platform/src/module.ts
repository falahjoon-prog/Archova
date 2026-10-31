import { AppError, defineModule, type Entitlements, type KernelServices } from '@archova/kernel';
import type { AccessService } from '@archova/mod-access';
import type { IdentityApi } from '@archova/mod-identity';
import { createCompanyService } from './application/companies';
import { createKeyDateService } from './application/key-dates';
import { createMemberService } from './application/members';
import { createOrgService, type OrgDeps } from './application/orgs';
import { createProjectService } from './application/projects';
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
      getOrg: orgs.getOrg,
      /** Project names for an open support session; read-only and org-wide, never a member's view (Sam 12 §4a). */
      listProjectsForSupport: async (orgId: string, staffId: string) => {
        // Checked here as well as by the caller, so this read cannot be reached without a live session.
        if (!deps.hasOpenSupportSession || !(await deps.hasOpenSupportSession(orgId, staffId)))
          throw new AppError('backoffice.support_no_session', 'There is no open support session.');
        return services.database.withTenantTx(
          {
            orgId,
            userId: staffId,
            principalType: 'external',
            orgRole: null,
            entitlements: { plan: 'support', state: 'read_only', modules: [], limits: {} },
            requestId: 'support',
          },
          (scope) => projects.listForSupport(scope),
          { readOnly: true },
        );
      },
      companyExists: companies.exists,
      projectCompanies: companies.onProject,
      projectCompaniesWithTrades: companies.onProjectWithTrades,
    },
  };
}

export type PlatformModule = ReturnType<typeof createPlatformModule>;
export type PlatformApi = PlatformModule['api'];
