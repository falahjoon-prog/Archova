// Meetings against the meetings module's endpoints (product/07): series, minutes, actions and issued versions.

import { unwrap } from '@archova/api-client';
import type { components } from '@archova/contracts/openapi';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type S = components['schemas'];
export type MeetingSeries = S['MeetingSeries'];
export type MeetingSummary = S['MeetingSummary'];
export type MeetingDetail = S['MeetingDetail'];
export type MeetingItem = S['MeetingItem'];
export type MeetingAction = S['MeetingAction'];
export type MeetingTemplate = S['MeetingTemplate'];
export type MeetingPerson = S['MeetingPerson'];
export type CreateItem = S['CreateMeetingItemRequest'];
export type UpdateItem = S['UpdateMeetingItemRequest'];
export type Issue = S['IssueMeetingRequest'];
export type Attendance = S['MeetingAttendance'];

const P = '/v1/orgs/{orgId}/projects/{projectId}' as const;
const ifMatch = (version: number) => ({ 'If-Match': `"${version}"` });
const idempotencyKey = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function createMeetingsApi(orgId: string) {
  const path = (projectId: string) => ({ orgId, projectId });
  return {
    async series(projectId: string): Promise<MeetingSeries[]> {
      return unwrap(await api.GET(`${P}/meeting-series`, { params: { path: path(projectId) } }))
        .data;
    },
    async createSeries(
      projectId: string,
      body: S['CreateMeetingSeriesRequest'],
    ): Promise<MeetingSeries> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/meeting-series`, {
          params: { path: path(projectId), header: idempotencyKey() },
          body,
        }),
      );
    },
    async meetings(projectId: string): Promise<MeetingSummary[]> {
      return unwrap(await api.GET(`${P}/meetings`, { params: { path: path(projectId) } })).data;
    },
    async createMeeting(
      projectId: string,
      seriesId: string,
      body: S['CreateMeetingRequest'],
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/meeting-series/{seriesId}/meetings`, {
          params: { path: { ...path(projectId), seriesId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async meeting(projectId: string, meetingId: string): Promise<MeetingDetail> {
      return unwrap(
        await api.GET(`${P}/meetings/{meetingId}`, {
          params: { path: { ...path(projectId), meetingId } },
        }),
      );
    },
    async update(
      projectId: string,
      meetingId: string,
      version: number,
      body: S['UpdateMeetingRequest'],
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/meetings/{meetingId}`, {
          params: { path: { ...path(projectId), meetingId }, header: ifMatch(version) },
          body,
        }),
      );
    },
    async setAttendees(
      projectId: string,
      meetingId: string,
      attendees: S['SetMeetingAttendeesRequest']['attendees'],
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.PUT(`${P}/meetings/{meetingId}/attendees`, {
          params: { path: { ...path(projectId), meetingId } },
          body: { attendees },
        }),
      );
    },
    async createItem(
      projectId: string,
      meetingId: string,
      body: CreateItem,
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/meetings/{meetingId}/items`, {
          params: { path: { ...path(projectId), meetingId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async updateItem(
      projectId: string,
      item: Pick<MeetingItem, 'id' | 'version'>,
      body: UpdateItem,
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.PATCH(`${P}/meeting-items/{itemId}`, {
          params: { path: { ...path(projectId), itemId: item.id }, header: ifMatch(item.version) },
          body,
        }),
      );
    },
    async deleteItem(projectId: string, itemId: string): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.DELETE(`${P}/meeting-items/{itemId}`, {
          params: { path: { ...path(projectId), itemId } },
        }),
      );
    },
    async issue(projectId: string, meetingId: string, body: Issue): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/meetings/{meetingId}/issue`, {
          params: { path: { ...path(projectId), meetingId }, header: idempotencyKey() },
          body,
        }),
      );
    },
    async pdf(projectId: string, meetingId: string, version: number): Promise<File> {
      const r = unwrap(
        await api.GET(`${P}/meetings/{meetingId}/versions/{version}/pdf`, {
          params: { path: { ...path(projectId), meetingId, version: String(version) } },
        }),
      );
      const bytes = Uint8Array.from(atob(r.dataBase64), (c) => c.charCodeAt(0));
      return new File([bytes], r.filename, { type: r.contentType });
    },
    async actions(projectId: string, scope: 'mine' | 'all'): Promise<MeetingAction[]> {
      return unwrap(
        await api.GET(`${P}/meeting-actions`, {
          params: { path: path(projectId), query: { scope } },
        }),
      ).data;
    },
  };
}
