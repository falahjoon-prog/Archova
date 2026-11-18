'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { createToolboxApi } from '../data/api';
import { toolboxPreview, type ToolboxSource } from '../data/source';
import type { TalkDetail, TalkInput, Topic, TopicInput } from '../lib/types';

function useSource(): ToolboxSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? toolboxPreview : createToolboxApi(orgId)), [orgId]);
}

function useScope() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return { orgId, projectId };
}

export function useTalkList() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'toolbox', { view: 'talks' }),
    queryFn: () => source.listTalks(projectId),
  });
}

export function useTalkDetail(id: string) {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'toolbox', id),
    queryFn: () => source.getTalk(projectId, id),
    enabled: id !== '',
  });
}

export function useTopics() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'toolbox', { view: 'topics' }),
    queryFn: () => source.listTopics(projectId),
  });
}

export function useSuggestions() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'toolbox', { view: 'suggestions' }),
    queryFn: () => source.suggestions(projectId),
  });
}

export function useToolboxMutations() {
  const source = useSource();
  const { orgId, projectId } = useScope();
  const qc = useQueryClient();
  // Wait for the refetch so the next action never carries a stale version.
  const settle = async (d: TalkDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'toolbox', d.talk.id), d);
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'toolbox') });
    return d;
  };
  const refresh = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'toolbox') });
    return v;
  };
  return {
    createTalk: useMutation({
      mutationFn: async (input: TalkInput) => settle(await source.createTalk(projectId, input)),
    }),
    transition: useMutation({
      mutationFn: async (v: { detail: TalkDetail; action: 'close' | 'reopen' }) =>
        settle(await source.transition(projectId, v.detail, v.action)),
    }),
    addAttendees: useMutation({
      mutationFn: async (v: {
        detail: TalkDetail;
        people: { personName: string; companyId?: string }[];
      }) => settle(await source.addAttendees(projectId, v.detail, v.people)),
    }),
    removeAttendee: useMutation({
      mutationFn: async (v: { detail: TalkDetail; attendeeId: string }) =>
        settle(await source.removeAttendee(projectId, v.detail, v.attendeeId)),
    }),
    sign: useMutation({
      mutationFn: async (v: { detail: TalkDetail; attendeeId: string; image: Blob }) =>
        settle(await source.sign(projectId, v.detail, v.attendeeId, v.image)),
    }),
    clearSignature: useMutation({
      mutationFn: async (v: { detail: TalkDetail; attendeeId: string }) =>
        settle(await source.clearSignature(projectId, v.detail, v.attendeeId)),
    }),
    createTopic: useMutation({
      mutationFn: async (input: TopicInput) => refresh(await source.createTopic(projectId, input)),
    }),
    setTopicActive: useMutation({
      mutationFn: async (v: { topic: Topic; isActive: boolean }) =>
        refresh(await source.setTopicActive(projectId, v.topic, v.isActive)),
    }),
  };
}
