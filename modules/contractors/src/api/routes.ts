import {
  AppError,
  defineRoutes,
  requirePrincipal,
  requireTenant,
  type Database,
} from '@archova/kernel';
import type { ContractorService } from '../application/contractors';

export function contractorsRoutes(database: Database, service: ContractorService) {
  const ro = { readOnly: true } as const;
  /** Only an org owner or admin decides who may work for the company. */
  const requireAdmin = (input: Parameters<typeof requireTenant>[0]) => {
    const t = requireTenant(input);
    if (t.orgRole !== 'owner' && t.orgRole !== 'admin')
      throw new AppError('access.denied', 'Only an org owner or admin can manage contractors.');
    return t;
  };
  return defineRoutes({
    getMyContractorProfile: async (input) => ({
      status: 200,
      body: await service.getProfile(requirePrincipal(input).userId),
    }),
    saveMyContractorProfile: async (input) => ({
      status: 200,
      body: await service.saveProfile(requirePrincipal(input).userId, input.body),
    }),
    searchContractorCompanies: async (input) => ({
      status: 200,
      body: await service.searchCompanies(requirePrincipal(input).userId, input.query.q),
    }),
    listMyContractorLinks: async (input) => ({
      status: 200,
      body: await service.listMyLinks(requirePrincipal(input).userId, {
        q: input.query.q,
        status: input.query.status,
        limit: input.query.limit ?? 50,
        cursor: input.query.cursor,
      }),
    }),
    requestContractorLink: async (input) => ({
      status: 201,
      body: await service.requestLink(requirePrincipal(input).userId, input.body.listingId),
    }),
    removeMyContractorLink: async (input) => {
      await service.removeMyLink(requirePrincipal(input).userId, input.params.linkId);
      return { status: 204 };
    },
    listCompanyContractors: async (input) => ({
      status: 200,
      body: await database.withTenantTx(
        requireAdmin(input),
        (s) =>
          service.listForCompany(s, {
            q: input.query.q,
            status: input.query.status,
            limit: input.query.limit ?? 50,
            cursor: input.query.cursor,
          }),
        ro,
      ),
    }),
    acceptContractorLink: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireAdmin(input), (s) =>
        service.decide(s, input.params.linkId, 'accepted'),
      ),
    }),
    rejectContractorLink: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireAdmin(input), (s) =>
        service.decide(s, input.params.linkId, 'rejected'),
      ),
    }),
    blockContractorLink: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireAdmin(input), (s) =>
        service.decide(s, input.params.linkId, 'blocked'),
      ),
    }),
    getContractorListing: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireAdmin(input), (s) => service.getListing(s), ro),
    }),
    setContractorListing: async (input) => ({
      status: 200,
      body: await database.withTenantTx(requireAdmin(input), (s) =>
        service.setListing(s, input.body.listed),
      ),
    }),
    endContractorLink: async (input) => {
      await database.withTenantTx(requireAdmin(input), (s) =>
        service.endForCompany(s, input.params.linkId),
      );
      return { status: 204 };
    },
  });
}
