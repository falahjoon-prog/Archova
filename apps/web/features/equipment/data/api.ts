// The project's equipment register, bookings and hours logs against the workforce endpoints.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Equipment = S['Equipment'];
export type EquipmentStatus = S['EquipmentStatus'];
export type EquipmentBooking = S['EquipmentBooking'];
export type EquipmentLog = S['EquipmentLog'];
export type CreateEquipment = S['CreateEquipmentRequest'];
export type CreateBooking = S['CreateEquipmentBookingRequest'];
export type LogHours = S['LogEquipmentHoursRequest'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createEquipmentApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async list(projectId: string): Promise<Equipment[]> {
      return unwrap(await api.GET(`${P}/equipment`, { params: { path: path(projectId) } })).data;
    },
    async create(projectId: string, body: CreateEquipment): Promise<Equipment> {
      return unwrap(
        await api.POST(`${P}/equipment`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async setStatus(
      projectId: string,
      equipmentId: string,
      status: EquipmentStatus,
    ): Promise<Equipment> {
      return unwrap(
        await api.PATCH(`${P}/equipment/{equipmentId}`, {
          params: { path: { ...path(projectId), equipmentId } },
          body: { status },
        }),
      );
    },
    async bookings(projectId: string, from: string, to: string): Promise<EquipmentBooking[]> {
      return unwrap(
        await api.GET(`${P}/equipment-bookings`, {
          params: { path: path(projectId), query: { from, to } },
        }),
      ).data;
    },
    async book(
      projectId: string,
      equipmentId: string,
      body: CreateBooking,
    ): Promise<EquipmentBooking> {
      return unwrap(
        await api.POST(`${P}/equipment/{equipmentId}/bookings`, {
          params: { path: { ...path(projectId), equipmentId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async cancelBooking(
      projectId: string,
      equipmentId: string,
      bookingId: string,
    ): Promise<EquipmentBooking> {
      return unwrap(
        await api.POST(`${P}/equipment/{equipmentId}/bookings/{bookingId}/cancel`, {
          params: { path: { ...path(projectId), equipmentId, bookingId } },
        }),
      );
    },
    async logs(projectId: string, equipmentId: string): Promise<EquipmentLog[]> {
      return unwrap(
        await api.GET(`${P}/equipment/{equipmentId}/logs`, {
          params: { path: { ...path(projectId), equipmentId } },
        }),
      ).data;
    },
    async logHours(projectId: string, equipmentId: string, body: LogHours): Promise<EquipmentLog> {
      return unwrap(
        await api.POST(`${P}/equipment/{equipmentId}/logs`, {
          params: { path: { ...path(projectId), equipmentId }, header: idempotencyKey() },
          body,
        }),
      );
    },
  };
}
