import { defineModule, type Entitlements, type KernelServices } from '@archova/kernel';
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
      getProject: projects.get,
      getOrg: orgs.getOrg,
      companyExists: companies.exists,
      projectCompanies: companies.onProject,
      projectCompaniesWithTrades: companies.onProjectWithTrades,
    },
  };
}

export type PlatformModule = ReturnType<typeof createPlatformModule>;
export type PlatformApi = PlatformModule['api'];
