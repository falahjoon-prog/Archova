// Material deliveries, the docks and cranes they book, and Nova's board checks against the logistics endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Delivery = S['Delivery'];
export type DeliveryStatus = S['DeliveryStatus'];
export type DeliveryDetail = S['DeliveryDetail'];
export type DeliveryFlag = S['DeliveryFlag'];
export type DeliveryInsights = S['DeliveryInsights'];
export type DeliverySlot = S['DeliverySlot'];
export type DeliveryNotice = S['DeliveryNotice'];
export type DeliveryItem = S['DeliveryItem'];
export type Resource = S['LogisticsResource'];
export type ResourceKind = S['LogisticsResourceKind'];
export type CreateDelivery = S['CreateDeliveryRequest'];
export type ChangeDelivery = S['ChangeDeliveryRequest'];
export type SlotRequest = S['DeliverySlotRequest'];
export type NoticeRequest = S['DeliveryNoticeRequest'];
export type CreateResource = S['CreateLogisticsResourceRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createDeliveriesApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  const withId = (projectId: string, deliveryId: string) => ({ ...path(projectId), deliveryId });
  return {
    async resources(projectId: string): Promise<Resource[]> {
      return unwrap(
        await api.GET(`${P}/logistics/resources`, { params: { path: path(projectId) } }),
      ).data;
    },
    async createResource(projectId: string, body: CreateResource): Promise<Resource> {
      return unwrap(
        await api.POST(`${P}/logistics/resources`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async list(projectId: string, from: string, to: string): Promise<Delivery[]> {
      return unwrap(
        await api.GET(`${P}/deliveries`, {
          params: { path: path(projectId), query: { from, to } },
        }),
      ).data;
    },
    async get(projectId: string, deliveryId: string): Promise<DeliveryDetail> {
      return unwrap(
        await api.GET(`${P}/deliveries/{deliveryId}`, {
          params: { path: withId(projectId, deliveryId) },
        }),
      );
    },
    async create(projectId: string, body: CreateDelivery): Promise<Delivery> {
      return unwrap(
        await api.POST(`${P}/deliveries`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async checkIn(
      projectId: string,
      deliveryId: string,
      event: 'arrived' | 'unloaded',
    ): Promise<Delivery> {
      return unwrap(
        await api.POST(`${P}/deliveries/{deliveryId}/check-in`, {
          params: { path: withId(projectId, deliveryId) },
          body: { event },
        }),
      );
    },
    async change(projectId: string, deliveryId: string, body: ChangeDelivery): Promise<Delivery> {
      return unwrap(
        await api.POST(`${P}/deliveries/{deliveryId}/changes`, {
          params: { path: withId(projectId, deliveryId) },
          body,
        }),
      );
    },
    async notice(
      projectId: string,
      deliveryId: string,
      body: NoticeRequest,
    ): Promise<DeliveryNotice> {
      return unwrap(
        await api.POST(`${P}/deliveries/{deliveryId}/notice`, {
          params: { path: withId(projectId, deliveryId) },
          body,
        }),
      );
    },
    async insights(projectId: string): Promise<DeliveryInsights> {
      return unwrap(await api.GET(`${P}/delivery-insights`, { params: { path: path(projectId) } }));
    },
    async suggest(projectId: string, body: SlotRequest): Promise<DeliverySlot[]> {
      return unwrap(
        await api.POST(`${P}/delivery-slot-suggestions`, {
          params: { path: path(projectId) },
          body,
        }),
      ).data;
    },
  };
}
