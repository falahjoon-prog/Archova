// Shifts and crew rosters against the workforce endpoints (ATT-US11).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Shift = S['Shift'];
export type ShiftAssignment = S['ShiftAssignment'];
export type ShiftStatus = S['ShiftStatus'];
export type CreateShift = S['CreateShiftRequest'];
export type ShiftResponse = S['RespondToShiftRequest']['status'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createRosterApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async shifts(projectId: string, from: string, to: string): Promise<Shift[]> {
      return unwrap(
        await api.GET(`${P}/shifts`, { params: { path: path(projectId), query: { from, to } } }),
      ).data;
    },
    async createShift(projectId: string, body: CreateShift): Promise<Shift> {
      return unwrap(
        await api.POST(`${P}/shifts`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async publish(projectId: string, shiftId: string): Promise<Shift> {
      return unwrap(
        await api.POST(`${P}/shifts/{shiftId}/publish`, {
          params: { path: { ...path(projectId), shiftId } },
        }),
      );
    },
    async cancel(projectId: string, shiftId: string): Promise<Shift> {
      return unwrap(
        await api.POST(`${P}/shifts/{shiftId}/cancel`, {
          params: { path: { ...path(projectId), shiftId } },
        }),
      );
    },
    async assign(projectId: string, shiftId: string, workerIds: string[]): Promise<Shift> {
      return unwrap(
        await api.POST(`${P}/shifts/{shiftId}/assignments`, {
          params: { path: { ...path(projectId), shiftId } },
          body: { workerIds },
        }),
      );
    },
    async unassign(projectId: string, shiftId: string, assignmentId: string): Promise<void> {
      unwrap(
        await api.DELETE(`${P}/shifts/{shiftId}/assignments/{assignmentId}`, {
          params: { path: { ...path(projectId), shiftId, assignmentId } },
        }),
      );
    },
    async respond(
      projectId: string,
      shiftId: string,
      assignmentId: string,
      status: ShiftResponse,
    ): Promise<Shift> {
      return unwrap(
        await api.POST(`${P}/shifts/{shiftId}/assignments/{assignmentId}/respond`, {
          params: { path: { ...path(projectId), shiftId, assignmentId } },
          body: { status },
        }),
      );
    },
  };
}
