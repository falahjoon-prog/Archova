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
export type Variation = S['Variation'];
export type VariationList = S['VariationList'];
export type VariationStatus = S['VariationStatus'];
export type CreateVariation = S['CreateVariationRequest'];
export type VariationAction = 'submit' | 'approve' | 'reject' | 'withdraw';
export type CostForecast = S['CostForecast'];
export type ForecastAdjustment = S['ForecastAdjustment'];
export type BudgetVsForecast = S['BudgetVsForecast'];
export type BudgetVsForecastRow = S['BudgetVsForecastRow'];
export type CreateForecastAdjustment = S['CreateForecastAdjustmentRequest'];
export type ContractPaymentSummary = S['ContractPaymentSummary'];
export type ContractTrust = S['ContractTrust'];
export type TrustMovement = S['TrustMovement'];
export type TrustStatus = S['TrustStatus'];
export type SaveContractTrust = S['SaveContractTrustRequest'];
export type RecordTrustMovement = S['RecordTrustMovementRequest'];
export type CreateContract = S['CreateContractRequest'];
export type SubmitPaymentClaim = S['SubmitPaymentClaimRequest'];
export type IssuePaymentSchedule = S['IssuePaymentScheduleRequest'];
export type RecordClaimStatement = S['RecordClaimStatementRequest'];

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
    async paymentSummary(projectId: string, contractId: string): Promise<ContractPaymentSummary> {
      return unwrap(
        await api.GET(`${P}/contracts/{contractId}/payment-summary`, {
          params: { path: { orgId, projectId, contractId } },
        }),
      );
    },
    async saveTrust(
      projectId: string,
      contractId: string,
      body: SaveContractTrust,
    ): Promise<ContractTrust> {
      return unwrap(
        await api.PUT(`${P}/contracts/{contractId}/trust`, {
          params: { path: { orgId, projectId, contractId } },
          body,
        }),
      );
    },
    async recordTrustMovement(
      projectId: string,
      contractId: string,
      body: RecordTrustMovement,
    ): Promise<ContractTrust> {
      return unwrap(
        await api.POST(`${P}/contracts/{contractId}/trust/movements`, {
          params: { path: { orgId, projectId, contractId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async costForecast(projectId: string): Promise<CostForecast> {
      return unwrap(
        await api.GET(`${P}/cost-forecast`, { params: { path: { orgId, projectId } } }),
      );
    },
    async budgetVsForecast(projectId: string): Promise<BudgetVsForecast> {
      return unwrap(
        await api.GET(`${P}/budget/vs-forecast`, { params: { path: { orgId, projectId } } }),
      );
    },
    async createAdjustment(
      projectId: string,
      body: CreateForecastAdjustment,
    ): Promise<ForecastAdjustment> {
      return unwrap(
        await api.POST(`${P}/cost-forecast/adjustments`, {
          params: { path: { orgId, projectId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async deleteAdjustment(projectId: string, adjustmentId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/cost-forecast/adjustments/{adjustmentId}`, {
          params: { path: { orgId, projectId, adjustmentId } },
        }),
      );
    },
    async variations(projectId: string, contractId: string): Promise<VariationList> {
      return unwrap(
        await api.GET(`${P}/contracts/{contractId}/variations`, {
          params: { path: { orgId, projectId, contractId } },
        }),
      );
    },
    async createVariation(
      projectId: string,
      contractId: string,
      body: CreateVariation,
    ): Promise<Variation> {
      return unwrap(
        await api.POST(`${P}/contracts/{contractId}/variations`, {
          params: { path: { orgId, projectId, contractId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async moveVariation(
      projectId: string,
      variationId: string,
      action: VariationAction,
      note?: string,
    ): Promise<Variation> {
      const params = { path: { orgId, projectId, variationId }, header: idempotencyKey() };
      const body = note ? { note } : {};
      switch (action) {
        case 'submit':
          return unwrap(await api.POST(`${P}/variations/{variationId}/submit`, { params }));
        case 'withdraw':
          return unwrap(await api.POST(`${P}/variations/{variationId}/withdraw`, { params }));
        case 'approve':
          return unwrap(await api.POST(`${P}/variations/{variationId}/approve`, { params, body }));
        case 'reject':
          return unwrap(await api.POST(`${P}/variations/{variationId}/reject`, { params, body }));
      }
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
    async recordStatement(
      projectId: string,
      claimId: string,
      body: RecordClaimStatement,
    ): Promise<PaymentClaimDetail> {
      return unwrap(
        await api.PUT(`${P}/payment-claims/{claimId}/subcontractor-statement`, {
          params: { path: { orgId, projectId, claimId } },
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
