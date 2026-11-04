// Support access (platform): the company's consent for Archova support to view its data, and the banner state.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type SupportAccess = S['SupportAccess'];
export type SupportGrant = S['SupportAccessGrant'];
export type SupportSession = S['SupportAccessSession'];
export type SupportBanner = S['SupportBanner'];
export type StaffAction = S['StaffAction'];
export type SupportRead = S['SupportRead'];
export type CreateGrant = S['CreateSupportAccessGrantRequest'];

const P = '/v1/orgs/{orgId}/support-access' as const;

export function createSupportAccessApi(orgId: string) {
  const path = { orgId };
  return {
    async get(): Promise<SupportAccess> {
      return unwrap(await api.GET(P, { params: { path } }));
    },
    async grant(body: CreateGrant): Promise<SupportGrant> {
      return unwrap(await api.POST(`${P}/grants`, { params: { path }, body }));
    },
    async revoke(grantId: string): Promise<void> {
      unwrap(
        await api.POST(`${P}/grants/{grantId}/revoke`, { params: { path: { orgId, grantId } } }),
      );
    },
    async staffActions(): Promise<StaffAction[]> {
      return unwrap(await api.GET('/v1/orgs/{orgId}/staff-actions', { params: { path } })).items;
    },
    async reads(): Promise<SupportRead[]> {
      return unwrap(await api.GET(`${P}/reads`, { params: { path } })).items;
    },
    async banner(): Promise<SupportBanner> {
      return unwrap(await api.GET(`${P}/banner`, { params: { path } }));
    },
  };
}
