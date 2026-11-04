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
export type LiveSource = S['MeetingLiveSource'];
export type LiveList = S['MeetingLiveList'];
export type LinkedItem = S['MeetingLinkedItem'];

/** One item Nova proposes from typed notes (F7): ids are public ids, `quote` is the notes' own words. */
export interface DraftedItem {
  kind: 'information' | 'decision' | 'action';
  text: string;
  quote: string;
  sectionId: string | null;
  attendeeId: string | null;
  dueDate: string | null;
}
export interface MinutesDraft {
  /** The `ais_` suggestion; decided once the person has added the items they want. */
  suggestionId: string;
  items: DraftedItem[];
  /** Items Nova proposed that failed the checks and were left out. */
  dropped: number;
}

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
    /** Minute items linked to one RFI, defect or variation, for its Related tab (MTG-AC5). */
    async linkedItems(
      projectId: string,
      link: { type: 'rfi' | 'defect' | 'variation'; id: string },
    ): Promise<LinkedItem[]> {
      return unwrap(
        await api.GET(`${P}/meeting-links`, {
          params: { path: path(projectId), query: link },
        }),
      ).data;
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
    /** F7: Nova proposes minute items from the notes; nothing is written to the minutes. */
    async draftMinutes(projectId: string, meetingId: string, notes: string): Promise<MinutesDraft> {
      await ensureCsrfToken();
      const s = unwrap(
        await api.POST(`${P}/meetings/{meetingId}/nova-minutes`, {
          params: { path: { ...path(projectId), meetingId } },
          body: { notes },
        }),
      );
      const payload = s.payload as { items: DraftedItem[]; dropped: number };
      return { suggestionId: s.id, items: payload.items, dropped: payload.dropped };
    },
    async decideDraft(
      projectId: string,
      suggestionId: string,
      decision: 'accepted' | 'rejected',
    ): Promise<void> {
      await ensureCsrfToken();
      unwrap(
        await api.POST(`${P}/ai/suggestions/{suggestionId}/decision`, {
          params: { path: { ...path(projectId), suggestionId } },
          body: { decision },
        }),
      );
    },
    /** MTG-US5: a section for notes, or a live list from a register when `liveSource` is given. */
    async addSection(
      projectId: string,
      meetingId: string,
      body: S['AddMeetingSectionRequest'],
    ): Promise<MeetingDetail> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${P}/meetings/{meetingId}/sections`, {
          params: { path: { ...path(projectId), meetingId } },
          body,
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
