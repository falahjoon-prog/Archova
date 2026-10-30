// Key dates (platform) and the delay register (scheduling) against their endpoints (product/08 S1, S3).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type KeyDates = S['KeyDates'];
export type KeyDateChange = S['KeyDateChange'];
export type UpdateKeyDates = S['UpdateKeyDatesRequest'];
export type DelayRegister = S['DelayRegister'];
export type DelayRow = S['DelayRegisterRow'];

export interface RegisterFilters {
  cause?: S['DiaryDelayType'];
  source?: 'diary' | 'rfi';
  eotOnly?: boolean;
  from?: string;
  to?: string;
}

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });

export function createScheduleApi(orgId: string) {
  return {
    async keyDates(projectId: string): Promise<KeyDates> {
      return unwrap(await api.GET(`${P}/key-dates`, { params: { path: { orgId, projectId } } }));
    },
    /** `version` is 0 until the dates have been saved once. */
    async updateKeyDates(
      projectId: string,
      version: number,
      body: UpdateKeyDates,
    ): Promise<KeyDates> {
      return unwrap(
        await api.PATCH(`${P}/key-dates`, {
          params: { path: { orgId, projectId }, header: ifMatch(version) },
          body,
        }),
      );
    },
    async keyDateChanges(projectId: string): Promise<KeyDateChange[]> {
      return unwrap(
        await api.GET(`${P}/key-dates/changes`, { params: { path: { orgId, projectId } } }),
      ).data;
    },
    async delayRegister(projectId: string, f: RegisterFilters): Promise<DelayRegister> {
      return unwrap(
        await api.GET(`${P}/delay-register`, {
          params: {
            path: { orgId, projectId },
            query: {
              ...(f.cause ? { cause: f.cause } : {}),
              ...(f.source ? { source: f.source } : {}),
              ...(f.eotOnly ? { eotOnly: 'true' as const } : {}),
              ...(f.from ? { from: f.from } : {}),
              ...(f.to ? { to: f.to } : {}),
            },
          },
        }),
      );
    },
  };
}
