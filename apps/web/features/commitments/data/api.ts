// Subcontracts and purchase orders against the project budget, with their change orders and payments.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Commitment = S['Commitment'];
export type CommitmentDetail = S['CommitmentDetail'];
export type CommitmentSummary = S['CommitmentSummary'];
export type ChangeOrder = S['CommitmentChangeOrder'];
export type CreateChangeOrder = S['CreateCommitmentChangeOrderRequest'];
export type Payment = S['CommitmentPayment'];
export type RecordPayment = S['RecordCommitmentPaymentRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createCommitmentsApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  const cpath = (projectId: string, commitmentId: string) => ({ orgId, projectId, commitmentId });
  return {
    async list(projectId: string): Promise<Commitment[]> {
      return unwrap(await api.GET(`${P}/commitments`, { params: { path: path(projectId) } })).data;
    },
    async summary(projectId: string): Promise<CommitmentSummary> {
      return unwrap(
        await api.GET(`${P}/commitment-summary`, { params: { path: path(projectId) } }),
      );
    },
    async get(projectId: string, commitmentId: string): Promise<CommitmentDetail> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}`, {
          params: { path: cpath(projectId, commitmentId) },
        }),
      );
    },
    async changeOrders(projectId: string, commitmentId: string): Promise<ChangeOrder[]> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}/change-orders`, {
          params: { path: cpath(projectId, commitmentId) },
        }),
      ).data;
    },
    async createChangeOrder(
      projectId: string,
      commitmentId: string,
      body: CreateChangeOrder,
    ): Promise<ChangeOrder> {
      return unwrap(
        await api.POST(`${P}/commitments/{commitmentId}/change-orders`, {
          params: { path: cpath(projectId, commitmentId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async moveChangeOrder(
      projectId: string,
      commitmentId: string,
      changeOrderId: string,
      to: 'submit' | 'approve' | 'reject',
      note?: string,
    ): Promise<ChangeOrder> {
      const params = {
        path: { ...cpath(projectId, commitmentId), changeOrderId },
        header: idempotencyKey(),
      };
      const route = `${P}/commitments/{commitmentId}/change-orders/{changeOrderId}/${to}` as const;
      return unwrap(
        await api.POST(route, { params, ...(to !== 'submit' && note ? { body: { note } } : {}) }),
      );
    },
    async payments(projectId: string, commitmentId: string): Promise<Payment[]> {
      return unwrap(
        await api.GET(`${P}/commitments/{commitmentId}/payments`, {
          params: { path: cpath(projectId, commitmentId) },
        }),
      ).data;
    },
    async recordPayment(
      projectId: string,
      commitmentId: string,
      body: RecordPayment,
    ): Promise<Payment> {
      return unwrap(
        await api.POST(`${P}/commitments/{commitmentId}/payments`, {
          params: { path: cpath(projectId, commitmentId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async voidPayment(
      projectId: string,
      commitmentId: string,
      paymentId: string,
      note: string,
    ): Promise<Payment> {
      return unwrap(
        await api.POST(`${P}/commitments/{commitmentId}/payments/{paymentId}/void`, {
          params: {
            path: { ...cpath(projectId, commitmentId), paymentId },
            header: idempotencyKey(),
          },
          body: { note },
        }),
      );
    },
  };
}
