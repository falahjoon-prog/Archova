// The company's side of sharing its wallet (workforce module): accept a builder's code, see who can read what,
// end an access, and read the always-on access log (compliance/05 §7).

import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type ShareCodePreview = S['ComplianceAccessRequestPreview'];
export type Grant = S['ComplianceGrant'];
export type AccessLogEntry = S['ComplianceAccessLogEntry'];

export function createSharingApi(orgId: string) {
  return {
    async preview(code: string): Promise<ShareCodePreview> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/compliance-share-codes/preview', {
          params: { path: { orgId } },
          body: { code },
        }),
      );
    },
    async accept(code: string): Promise<Grant> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/compliance-grants', {
          params: { path: { orgId }, header: { 'Idempotency-Key': crypto.randomUUID() } },
          body: { code },
        }),
      );
    },
    async grants(): Promise<Grant[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/compliance-grants', { params: { path: { orgId } } }),
      ).data;
    },
    async revoke(g: Grant): Promise<Grant> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/compliance-grants/{grantId}/revoke', {
          params: {
            path: { orgId, grantId: g.id },
            header: { 'If-Match': `"${g.version}"` },
          },
        }),
      );
    },
    async log(): Promise<AccessLogEntry[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/compliance-access-log', { params: { path: { orgId } } }),
      ).data;
    },
  };
}
