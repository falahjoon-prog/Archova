import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type ProgressUpdate = S['OwnerProgressUpdate'];
export type CreateProgressUpdate = S['CreateOwnerProgressUpdateRequest'];
export type Approval = S['OwnerApproval'];
export type CreateApproval = S['CreateOwnerApprovalRequest'];
export type CapitalPlan = S['OwnerCapitalPlan'];
export type CapitalItemInput = S['OwnerCapitalItemInput'];

const B = '/v1/orgs/{orgId}/projects/{projectId}/owner-portal';
const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Live API only: the portal shows what the builder published on the server. */
export function createOwnerPortalApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async updates(projectId: string): Promise<ProgressUpdate[]> {
      return unwrap(
        await api.GET(`${B}/progress-updates` as const, { params: { path: path(projectId) } }),
      ).data;
    },
    async createUpdate(projectId: string, body: CreateProgressUpdate): Promise<ProgressUpdate> {
      return unwrap(
        await api.POST(`${B}/progress-updates` as const, {
          params: { path: path(projectId), header: idem() },
          body,
        }),
      );
    },
    async publishUpdate(projectId: string, updateId: string): Promise<ProgressUpdate> {
      return unwrap(
        await api.POST(`${B}/progress-updates/{updateId}/publish` as const, {
          params: { path: { ...path(projectId), updateId } },
        }),
      );
    },
    async approvals(projectId: string): Promise<Approval[]> {
      return unwrap(await api.GET(`${B}/approvals` as const, { params: { path: path(projectId) } }))
        .data;
    },
    async requestApproval(projectId: string, body: CreateApproval): Promise<Approval> {
      return unwrap(
        await api.POST(`${B}/approvals` as const, {
          params: { path: path(projectId), header: idem() },
          body,
        }),
      );
    },
    async decide(
      projectId: string,
      approvalId: string,
      decision: 'approved' | 'rejected',
      note?: string,
    ): Promise<Approval> {
      return unwrap(
        await api.POST(`${B}/approvals/{approvalId}/decision` as const, {
          params: { path: { ...path(projectId), approvalId } },
          body: { decision, ...(note ? { note } : {}) },
        }),
      );
    },
    async withdraw(projectId: string, approvalId: string): Promise<Approval> {
      return unwrap(
        await api.POST(`${B}/approvals/{approvalId}/withdraw` as const, {
          params: { path: { ...path(projectId), approvalId } },
        }),
      );
    },
    async plan(projectId: string): Promise<CapitalPlan> {
      return unwrap(
        await api.GET(`${B}/capital-plan` as const, { params: { path: path(projectId) } }),
      );
    },
    async addItem(projectId: string, body: CapitalItemInput) {
      return unwrap(
        await api.POST(`${B}/capital-plan` as const, {
          params: { path: path(projectId), header: idem() },
          body,
        }),
      );
    },
    async updateItem(
      projectId: string,
      itemId: string,
      version: number,
      body: Partial<CapitalItemInput>,
    ) {
      return unwrap(
        await api.PATCH(`${B}/capital-plan/{itemId}` as const, {
          params: {
            path: { ...path(projectId), itemId },
            header: { 'If-Match': `"${version}"` },
          },
          body,
        }),
      );
    },
    async removeItem(projectId: string, itemId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${B}/capital-plan/{itemId}` as const, {
          params: { path: { ...path(projectId), itemId } },
        }),
      );
    },
  };
}
