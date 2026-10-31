// Contracts, payment claims and payment schedules against the financials endpoints (product/09, PR #207).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Contract = S['Contract'];
export type ContractDetail = S['ContractDetail'];
export type SovItem = S['SovItem'];
export type PaymentClaim = S['PaymentClaim'];
export type PaymentClaimDetail = S['PaymentClaimDetail'];
export type PaymentClaimStatus = S['PaymentClaimStatus'];
export type CreateContract = S['CreateContractRequest'];
export type SubmitPaymentClaim = S['SubmitPaymentClaimRequest'];
export type IssuePaymentSchedule = S['IssuePaymentScheduleRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createClaimsApi(orgId: string) {
  return {
    async contracts(projectId: string): Promise<Contract[]> {
      return unwrap(await api.GET(`${P}/contracts`, { params: { path: { orgId, projectId } } }))
        .data;
    },
    async contract(projectId: string, contractId: string): Promise<ContractDetail> {
      return unwrap(
        await api.GET(`${P}/contracts/{contractId}`, {
          params: { path: { orgId, projectId, contractId } },
        }),
      );
    },
    async createContract(projectId: string, body: CreateContract): Promise<ContractDetail> {
      return unwrap(
        await api.POST(`${P}/contracts`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async claims(projectId: string, status?: PaymentClaimStatus): Promise<PaymentClaim[]> {
      return unwrap(
        await api.GET(`${P}/payment-claims`, {
          params: { path: { orgId, projectId }, query: status ? { status } : {} },
        }),
      ).data;
    },
    async claim(projectId: string, claimId: string): Promise<PaymentClaimDetail> {
      return unwrap(
        await api.GET(`${P}/payment-claims/{claimId}`, {
          params: { path: { orgId, projectId, claimId } },
        }),
      );
    },
    async submitClaim(
      projectId: string,
      contractId: string,
      body: SubmitPaymentClaim,
    ): Promise<PaymentClaimDetail> {
      return unwrap(
        await api.POST(`${P}/contracts/{contractId}/claims`, {
          params: { path: { orgId, projectId, contractId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async issueSchedule(
      projectId: string,
      claimId: string,
      body: IssuePaymentSchedule,
    ): Promise<PaymentClaimDetail> {
      return unwrap(
        await api.POST(`${P}/payment-claims/{claimId}/schedule`, {
          params: { path: { orgId, projectId, claimId }, header: idempotencyKey() },
          body,
        }),
      );
    },
  };
}
