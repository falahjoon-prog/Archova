// Meetings on the phone (product 07): read the minutes and close your own actions, online. Writing minutes stays on
// the web. The same endpoints serve both, so an outsider only ever gets the issued version they were sent (MTG-AC7).
import { unwrap, type ApiClient } from '@archova/api-client';

export interface MeetingTarget {
  orgId: string;
  projectId: string;
}

const path = (t: MeetingTarget) => ({ orgId: t.orgId, projectId: t.projectId });

export async function listMeetings(api: ApiClient, t: MeetingTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/meetings', { params: { path: path(t) } }),
  ).data;
}

/** Open actions that are mine (my company's too), soonest due first. */
export async function myActions(api: ApiClient, t: MeetingTarget) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/meeting-actions', {
      params: { path: path(t), query: { scope: 'mine' } },
    }),
  ).data;
}

export async function getMeeting(api: ApiClient, t: MeetingTarget, meetingId: string) {
  return unwrap(
    await api.GET('/v1/orgs/{orgId}/projects/{projectId}/meetings/{meetingId}', {
      params: { path: { ...path(t), meetingId } },
    }),
  );
}

/** Closing needs the item's version, so a change made elsewhere since it was read is refused, not overwritten. */
export async function closeAction(
  api: ApiClient,
  t: MeetingTarget,
  item: { id: string; version: number },
) {
  return unwrap(
    await api.PATCH('/v1/orgs/{orgId}/projects/{projectId}/meeting-items/{itemId}', {
      params: {
        path: { ...path(t), itemId: item.id },
        header: { 'If-Match': `"${item.version}"` },
      },
      body: { status: 'closed' },
    }),
  );
}
