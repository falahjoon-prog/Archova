// Support access (platform): the company's consent for Archova support to view its data, and the banner state.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type SupportAccess = S['SupportAccess'];
export type SupportSession = S['SupportSessionSummary'];
export type SupportBanner = S['SupportBanner'];
export type GrantSupportAccess = S['GrantSupportAccessRequest'];

const P = '/v1/orgs/{orgId}/support-access' as const;

export function createSupportAccessApi(orgId: string) {
  const params = { path: { orgId } };
  return {
    async get(): Promise<SupportAccess> {
      return unwrap(await api.GET(P, { params }));
    },
    async grant(body: GrantSupportAccess): Promise<SupportAccess> {
      return unwrap(await api.PUT(P, { params, body }));
    },
    async revoke(): Promise<void> {
      unwrap(await api.DELETE(P, { params }));
    },
    async banner(): Promise<SupportBanner> {
      return unwrap(await api.GET(`${P}/banner`, { params }));
    },
  };
}
