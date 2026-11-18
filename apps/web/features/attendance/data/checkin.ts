import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { delay } from '@/shared/mocks/runtime';
import { checkInMessage, type CheckInMessage } from '../lib/checkin';

export interface CheckInSource {
  checkIn(projectId: string, gateCode: string): Promise<CheckInMessage>;
  checkOut(projectId: string, gateCode: string | null): Promise<CheckInMessage>;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}/attendance' as const;
const headers = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createCheckInApi(orgId: string): CheckInSource {
  return {
    async checkIn(projectId, gateCode) {
      const r = unwrap(
        await api.POST(`${P}/sign-in`, {
          params: { path: { orgId, projectId }, header: headers() },
          body: { gateCode, clientAt: new Date().toISOString() },
        }),
      );
      return checkInMessage(r);
    },
    async checkOut(projectId, gateCode) {
      unwrap(
        await api.POST(`${P}/sign-out`, {
          params: { path: { orgId, projectId }, header: headers() },
          body: { ...(gateCode ? { gateCode } : {}), clientAt: new Date().toISOString() },
        }),
      );
      return checkInMessage({ outcome: 'signed_out', eligibility: null });
    },
  };
}

export const checkInPreview: CheckInSource = {
  checkIn: () => delay(checkInMessage({ outcome: 'accepted', eligibility: null })),
  checkOut: () => delay(checkInMessage({ outcome: 'signed_out', eligibility: null })),
};
