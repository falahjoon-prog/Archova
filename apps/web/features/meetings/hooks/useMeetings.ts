'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createMeetingsApi, type MeetingDetail } from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createMeetingsApi(orgId), [orgId]);
}

export function useSeries() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'meetings', { series: true }),
    queryFn: () => source.series(projectId),
  });
}

export function useMeetingList() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'meetings', {}),
    queryFn: () => source.meetings(projectId),
  });
}

export function useMyActions(scope: 'mine' | 'all') {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'meetings', { actions: scope }),
    queryFn: () => source.actions(projectId, scope),
  });
}

export function useMeeting(meetingId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'meetings', meetingId),
    queryFn: () => source.meeting(projectId, meetingId),
  });
}

/** Everything in the minutes is shared with the people in the room, so a save waits for the server. */
export function useMeetingMutations(meetingId: string | null) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const source = useApi();
  const qc = useQueryClient();
  const settle = (d: MeetingDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'meetings', meetingId ?? d.meeting.id), d);
    return qc.invalidateQueries({ queryKey: queryKeys.toolList(orgId, projectId, 'meetings') });
  };
  const id = () => {
    if (!meetingId) throw new Error('No meeting is open');
    return meetingId;
  };
  return {
    createSeries: useMutation({
      mutationFn: (body: Parameters<typeof source.createSeries>[1]) =>
        source.createSeries(projectId, body),
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'meetings') }),
    }),
    createMeeting: useMutation({
      mutationFn: (v: { seriesId: string; body: Parameters<typeof source.createMeeting>[2] }) =>
        source.createMeeting(projectId, v.seriesId, v.body),
      onSuccess: settle,
    }),
    update: useMutation({
      mutationFn: (v: { version: number; body: Parameters<typeof source.update>[3] }) =>
        source.update(projectId, id(), v.version, v.body),
      onSuccess: settle,
    }),
    setAttendees: useMutation({
      mutationFn: (attendees: Parameters<typeof source.setAttendees>[2]) =>
        source.setAttendees(projectId, id(), attendees),
      onSuccess: settle,
    }),
    createItem: useMutation({
      mutationFn: (body: Parameters<typeof source.createItem>[2]) =>
        source.createItem(projectId, id(), body),
      onSuccess: settle,
    }),
    draftMinutes: useMutation({
      mutationFn: (notes: string) => source.draftMinutes(projectId, id(), notes),
    }),
    /** Adds the chosen items one at a time (each is its own numbered item), then records the draft as used. */
    addDrafted: useMutation({
      mutationFn: async (v: {
        suggestionId: string;
        items: Array<Parameters<typeof source.createItem>[2]>;
        onAdded?: (index: number) => void;
      }) => {
        let last: MeetingDetail | null = null;
        for (const [i, body] of v.items.entries()) {
          last = await source.createItem(projectId, id(), body);
          v.onAdded?.(i);
        }
        await source.decideDraft(projectId, v.suggestionId, 'accepted');
        return last;
      },
      onSettled: () =>
        qc.invalidateQueries({ queryKey: queryKeys.toolItem(orgId, projectId, 'meetings', id()) }),
    }),
    rejectDraft: useMutation({
      mutationFn: (suggestionId: string) => source.decideDraft(projectId, suggestionId, 'rejected'),
    }),
    updateItem: useMutation({
      mutationFn: (v: {
        item: Parameters<typeof source.updateItem>[1];
        body: Parameters<typeof source.updateItem>[2];
      }) => source.updateItem(projectId, v.item, v.body),
      onSuccess: settle,
    }),
    deleteItem: useMutation({
      mutationFn: (itemId: string) => source.deleteItem(projectId, itemId),
      onSuccess: settle,
    }),
    issue: useMutation({
      mutationFn: (body: Parameters<typeof source.issue>[2]) => source.issue(projectId, id(), body),
      onSuccess: settle,
    }),
    pdf: useMutation({
      mutationFn: (version: number) => source.pdf(projectId, id(), version),
    }),
  };
}
