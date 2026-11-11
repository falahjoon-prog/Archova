// The project's warranty register, claim history and Nova flags against the defects module's warranty endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type WarrantyItem = S['WarrantyItem'];
export type WarrantyItemDetail = S['WarrantyItemDetail'];
export type WarrantyClaim = S['WarrantyClaim'];
export type WarrantySummary = S['WarrantySummary'];
export type WarrantyFlag = S['WarrantyFlag'];
export type WarrantySystem = S['WarrantySystem'];
export type WarrantyState = S['WarrantyState'];
export type WarrantyResponsibleType = S['WarrantyResponsibleType'];
export type CreateWarrantyItem = S['CreateWarrantyItemRequest'];
export type UpdateWarrantyItem = S['UpdateWarrantyItemRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createWarrantyApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async list(projectId: string, query: { state?: WarrantyState } = {}): Promise<WarrantyItem[]> {
      return unwrap(
        await api.GET(`${P}/warranty-items`, { params: { path: path(projectId), query } }),
      ).data;
    },
    async summary(projectId: string): Promise<WarrantySummary> {
      return unwrap(await api.GET(`${P}/warranty/summary`, { params: { path: path(projectId) } }));
    },
    async claims(projectId: string): Promise<WarrantyClaim[]> {
      return unwrap(await api.GET(`${P}/warranty/claims`, { params: { path: path(projectId) } }))
        .data;
    },
    async get(projectId: string, itemId: string): Promise<WarrantyItemDetail> {
      return unwrap(
        await api.GET(`${P}/warranty-items/{itemId}`, {
          params: { path: { ...path(projectId), itemId } },
        }),
      );
    },
    async create(projectId: string, body: CreateWarrantyItem): Promise<WarrantyItemDetail> {
      return unwrap(
        await api.POST(`${P}/warranty-items`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async update(
      projectId: string,
      itemId: string,
      version: number,
      body: UpdateWarrantyItem,
    ): Promise<WarrantyItemDetail> {
      return unwrap(
        await api.PATCH(`${P}/warranty-items/{itemId}`, {
          params: {
            path: { ...path(projectId), itemId },
            header: { 'If-Match': `"${version}"` },
          },
          body,
        }),
      );
    },
    async remove(projectId: string, itemId: string, version: number): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/warranty-items/{itemId}`, {
          params: {
            path: { ...path(projectId), itemId },
            header: { 'If-Match': `"${version}"` },
          },
        }),
      );
    },
  };
}
