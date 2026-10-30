'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createSubmittalsApi, submittalsPreview, type SubmittalsSource } from '../data/api';
import type { ReviewAnswer, SubmittalDetail, SubmittalFilters, SubmittalInput } from '../lib/types';

function useSource(): SubmittalsSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? submittalsPreview : createSubmittalsApi(orgId)), [orgId]);
}

export function useSubmittalList(projectId: string, filters: SubmittalFilters) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'submittals', { ...filters }),
    queryFn: () => source.list(projectId, filters),
  });
}

export function useSubmittal(projectId: string, id: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'submittals', id),
    queryFn: () => source.get(projectId, id),
  });
}

/** Every write waits for the server: a review is part of the record, so none of them is optimistic. */
export function useSubmittalMutations(projectId: string) {
  const source = useSource();
  const { orgId } = useCurrentOrg();
  const qc = useQueryClient();
  const settle = (d: SubmittalDetail) => {
    qc.setQueryData(queryKeys.toolItem(orgId, projectId, 'submittals', d.submittal.id), d);
    return qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'submittals') });
  };
  return {
    create: useMutation({
      mutationFn: (input: SubmittalInput) => source.create(projectId, input),
      onSuccess: settle,
    }),
    submit: useMutation({
      mutationFn: (v: {
        id: string;
        version: number;
        files: File[];
        note: string;
        reviewerIds?: string[];
      }) => source.submit(projectId, v.id, v.version, v),
      onSuccess: settle,
    }),
    respond: useMutation({
      mutationFn: (v: {
        id: string;
        stepId: string;
        response: ReviewAnswer;
        comments: string;
        files: File[];
      }) => source.respond(projectId, v.id, v.stepId, v),
      onSuccess: settle,
    }),
    close: useMutation({
      mutationFn: (v: { id: string; version: number }) => source.close(projectId, v.id, v.version),
      onSuccess: settle,
    }),
  };
}
