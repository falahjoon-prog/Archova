// Builder side of the compliance wallet (workforce module): ask a subcontractor for documents, then read what they
// share through a grant (compliance/05 §7). Files come as 60-second links; nothing is stored here.

import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type AccessRequest = S['ComplianceAccessRequest'];
export type AccessRequestCreated = S['ComplianceAccessRequestCreated'];
export type CreateAccessRequest = S['CreateComplianceAccessRequest'];
export type GrantedWallet = S['GrantedWallet'];
export type SharedDocument = S['SharedComplianceDocument'];
export type Snapshot = S['ComplianceSnapshot'];
export type SnapshotReason = S['CreateComplianceSnapshotRequest']['reason'];

const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createSubcontractorWalletsApi(orgId: string) {
  return {
    async requests(): Promise<AccessRequest[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/compliance-access-requests', {
          params: { path: { orgId } },
        }),
      ).data;
    },
    async createRequest(body: CreateAccessRequest): Promise<AccessRequestCreated> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/compliance-access-requests', {
          params: { path: { orgId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async cancelRequest(r: AccessRequest): Promise<AccessRequest> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/compliance-access-requests/{requestId}/cancel', {
          params: {
            path: { orgId, requestId: r.id },
            header: { 'If-Match': `"${r.version}"` },
          },
        }),
      );
    },
    async wallets(): Promise<GrantedWallet[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/subcontractor-wallets', { params: { path: { orgId } } }),
      ).data;
    },
    /** Each read is written to the subcontractor's access log by the server. */
    async documents(grantId: string, projectId: string): Promise<SharedDocument[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/subcontractor-wallets/{grantId}/documents', {
          params: { path: { orgId, grantId }, query: { projectId } },
        }),
      ).data;
    },
    async fileLink(
      grantId: string,
      projectId: string,
      documentId: string,
      position: number,
    ): Promise<string> {
      return unwrap(
        await api.GET(
          '/v1/orgs/{orgId}/subcontractor-wallets/{grantId}/documents/{documentId}/files/{position}',
          {
            params: {
              path: {
                orgId,
                grantId,
                documentId,
                position: String(position) as '1' | '2' | '3' | '4',
              },
              query: { projectId },
            },
          },
        ),
      ).url;
    },
    async snapshot(
      grantId: string,
      body: { projectId: string; documentId: string; reason: SnapshotReason },
    ): Promise<Snapshot> {
      return unwrap(
        await api.POST('/v1/orgs/{orgId}/subcontractor-wallets/{grantId}/snapshots', {
          params: { path: { orgId, grantId }, header: idempotencyKey() },
          body,
        }),
      );
    },
  };
}
