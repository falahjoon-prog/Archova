'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { LocalDate } from '@archova/time';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createDiaryApi } from '../data/api';
import { diarySource as previewSource, type DiarySource } from '../data/source';
import type { DiaryContent, DiaryEntry, Weather } from '../lib/types';

/** The API once the diary endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useDiarySource(): DiarySource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createDiaryApi(orgId)), [orgId]);
}

export function useDiaryDay(date: LocalDate, today: LocalDate) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const diarySource = useDiarySource();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'diary', date),
    queryFn: () => diarySource.getDay(projectId, date, today),
  });
}

/** Nova's summary of one week; a mutation because the first ask does the work and spends the credit. */
export function useWeekSummary() {
  const { projectId } = useCurrentProject();
  const diarySource = useDiarySource();
  return {
    summarise: useMutation({
      mutationFn: (weekStart: LocalDate) => diarySource.novaWeekSummary(projectId, weekStart),
    }),
    decide: useMutation({
      mutationFn: (v: { id: string; decision: 'accepted' | 'rejected' }) =>
        diarySource.novaWeekDecide(projectId, v.id, v.decision),
    }),
  };
}

export function useDiaryRange(from: LocalDate, to: LocalDate) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const diarySource = useDiarySource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'diary', { from, to }),
    queryFn: () => diarySource.list(projectId, from, to),
  });
}

/** Days with site activity but no submitted daily log (Nova's gap flag). */
export function useDiaryGaps(from: LocalDate, to: LocalDate) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const diarySource = useDiarySource();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'diary', { gaps: true, from, to }),
    queryFn: () => diarySource.gaps(projectId, from, to),
  });
}

/**
 * Draft autosave writes through (it's the user's own draft); submit, amend and sign-off wait for the server
 * because they are evidence (X42, frontend 02 §3).
 */
export function useDiaryMutations(date: LocalDate) {
  const { orgId } = useCurrentOrg();
  const { projectId, timezone } = useCurrentProject();
  const actor = useActor();
  const diarySource = useDiarySource();
  const qc = useQueryClient();
  const settle = (entry: DiaryEntry) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'diary', date), entry);
    return qc.invalidateQueries({ queryKey: queryKeys.toolList(orgId, projectId, 'diary') });
  };
  return {
    saveDraft: useMutation({
      mutationFn: (content: DiaryContent) => diarySource.saveDraft(projectId, date, content),
      onSuccess: settle,
    }),
    submit: useMutation({
      mutationFn: (content: DiaryContent) =>
        diarySource.submit(projectId, date, content, actor, timezone),
      onSuccess: settle,
    }),
    amend: useMutation({
      mutationFn: (v: { content: DiaryContent; reason: string }) =>
        diarySource.amend(projectId, date, v.content, v.reason, actor),
      onSuccess: settle,
    }),
    signOff: useMutation({
      mutationFn: () => diarySource.signOff(projectId, date, actor),
      onSuccess: settle,
    }),
    summary: useMutation({
      mutationFn: (v: { content: DiaryContent; weather: Weather | null }) =>
        diarySource.novaSummary(projectId, date, v.content, v.weather),
    }),
  };
}
