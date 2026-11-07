// Subcontracts and purchase orders against the project budget (financials commitments endpoints).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Commitment = S['Commitment'];
export type CommitmentDetail = S['CommitmentDetail'];
export type CommitmentInvoices = S['CommitmentInvoices'];
export type CommitmentInvoice = S['CommitmentInvoice'];
export type CommitmentInvoiceSummary = S['CommitmentInvoiceSummary'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;

export function createCommitmentsApi(orgId: string) {
  return {
    async list(projectId: string): Promise<Commitment[]> {
      return unwrap(await api.GET(`${P}/commitments`, { params: { path: { orgId, projectId } } }))
        .data;
    },
    async get(projectId: string, commitmentId: string): Promise<CommitmentDetail> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}`, {
          params: { path: { orgId, projectId, commitmentId } },
        }),
      );
    },
    async invoices(projectId: string, commitmentId: string): Promise<CommitmentInvoices> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}/invoices`, {
          params: { path: { orgId, projectId, commitmentId } },
        }),
      );
    },
    async linkContract(
      projectId: string,
      commitmentId: string,
      contractId: string | null,
    ): Promise<CommitmentDetail> {
      return unwrap(
        await api.PUT(`${P}/commitments/{commitmentId}/contract`, {
          params: { path: { orgId, projectId, commitmentId } },
          body: { contractId },
        }),
      );
    },
  };
}
