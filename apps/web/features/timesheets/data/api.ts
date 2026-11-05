// Daily timesheets built from sign-ins, against the workforce endpoints (ATT-US9).

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api } from '@/shared/lib/api';

type S = components['schemas'];
export type Timesheet = S['Timesheet'];
export type TimesheetLine = S['TimesheetLine'];
export type TimesheetStatus = S['TimesheetStatus'];
export type AddLine = S['AddTimesheetLineRequest'];
export type AdjustLine = S['AdjustTimesheetLineRequest'];
export type TimesheetExport = S['TimesheetExport'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createTimesheetsApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  const sheet = (projectId: string, timesheetId: string) => ({
    ...path(projectId),
    timesheetId,
  });
  return {
    async list(projectId: string, from: string, to: string): Promise<Timesheet[]> {
      return unwrap(
        await api.GET(`${P}/timesheets`, {
          params: { path: path(projectId), query: { from, to } },
        }),
      ).data;
    },
    async generate(projectId: string, from: string, to: string) {
      return unwrap(
        await api.POST(`${P}/timesheets/generate`, {
          params: { path: path(projectId) },
          body: { from, to },
        }),
      );
    },
    async addLine(projectId: string, timesheetId: string, body: AddLine): Promise<Timesheet> {
      return unwrap(
        await api.POST(`${P}/timesheets/{timesheetId}/lines`, {
          params: { path: sheet(projectId, timesheetId) },
          body,
        }),
      );
    },
    async adjustLine(
      projectId: string,
      timesheetId: string,
      lineId: string,
      body: AdjustLine,
    ): Promise<Timesheet> {
      return unwrap(
        await api.PATCH(`${P}/timesheets/{timesheetId}/lines/{lineId}`, {
          params: { path: { ...sheet(projectId, timesheetId), lineId } },
          body,
        }),
      );
    },
    async submit(projectId: string, timesheetId: string): Promise<Timesheet> {
      return unwrap(
        await api.POST(`${P}/timesheets/{timesheetId}/submit`, {
          params: { path: sheet(projectId, timesheetId) },
        }),
      );
    },
    async approve(projectId: string, timesheetId: string): Promise<Timesheet> {
      return unwrap(
        await api.POST(`${P}/timesheets/{timesheetId}/approve`, {
          params: { path: sheet(projectId, timesheetId) },
        }),
      );
    },
    async reject(projectId: string, timesheetId: string, reason: string): Promise<Timesheet> {
      return unwrap(
        await api.POST(`${P}/timesheets/{timesheetId}/reject`, {
          params: { path: sheet(projectId, timesheetId) },
          body: { reason },
        }),
      );
    },
    async exportCsv(projectId: string, from: string, to: string): Promise<TimesheetExport> {
      return unwrap(
        await api.POST(`${P}/timesheets/export`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body: { from, to },
        }),
      );
    },
  };
}
