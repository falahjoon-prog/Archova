// Free contractor tier (X64): the contractor's own endpoints and the company's pending-requests endpoints.

import { ApiError, unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type ContractorProfile = S['ContractorProfile'];
export type ContractorProfileInput = S['ContractorProfileInput'];
export type ContractorCompany = S['ContractorCompany'];
export type ContractorLink = S['ContractorLink'];
export type ContractorLinkStatus = S['ContractorLinkStatus'];
export type CompanyContractor = S['CompanyContractor'];

export const contractorApi = {
  /** `null` when this account has no contractor profile yet. */
  async profile(): Promise<ContractorProfile | null> {
    try {
      return unwrap(await api.GET('/v1/me/contractor'));
    } catch (e) {
      if (e instanceof ApiError && e.problem?.code === 'contractor.no_profile') return null;
      throw e;
    }
  },
  async saveProfile(body: ContractorProfileInput): Promise<ContractorProfile> {
    await ensureCsrfToken();
    return unwrap(await api.PUT('/v1/me/contractor', { body }));
  },
  async searchCompanies(q: string): Promise<ContractorCompany[]> {
    return unwrap(await api.GET('/v1/me/contractor/companies', { params: { query: { q } } })).data;
  },
  async links(o: { q?: string; cursor?: string }) {
    return unwrap(
      await api.GET('/v1/me/contractor/links', {
        params: {
          query: {
            limit: 25,
            ...(o.q ? { q: o.q } : {}),
            ...(o.cursor ? { cursor: o.cursor } : {}),
          },
        },
      }),
    );
  },
  async request(companyId: string): Promise<ContractorLink> {
    await ensureCsrfToken();
    return unwrap(await api.POST('/v1/me/contractor/links', { body: { companyId } }));
  },
  async remove(linkId: string): Promise<void> {
    await ensureCsrfToken();
    unwrap(await api.DELETE('/v1/me/contractor/links/{linkId}', { params: { path: { linkId } } }));
  },
};

export function createCompanyContractorsApi(orgId: string) {
  const org = { orgId };
  return {
    async list(o: { status?: ContractorLinkStatus; cursor?: string }) {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/contractors', {
          params: {
            path: org,
            query: {
              limit: 25,
              ...(o.status ? { status: o.status } : {}),
              ...(o.cursor ? { cursor: o.cursor } : {}),
            },
          },
        }),
      );
    },
    async accept(linkId: string): Promise<CompanyContractor> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/contractors/{linkId}/accept', {
          params: { path: { ...org, linkId } },
        }),
      );
    },
    async reject(linkId: string): Promise<CompanyContractor> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/contractors/{linkId}/reject', {
          params: { path: { ...org, linkId } },
        }),
      );
    },
    async end(linkId: string): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.DELETE('/v1/orgs/{orgId}/contractors/{linkId}', {
          params: { path: { ...org, linkId } },
        }),
      );
    },
  };
}
