'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createReviewsApi, type ReviewsApi, type StartReviewInput } from '../data/reviews-api';

function useReviewsApi(projectId: string): ReviewsApi {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createReviewsApi({ orgId, projectId }), [orgId, projectId]);
}

export function useDocumentReview(projectId: string, documentId: string | null) {
  const { orgId } = useCurrentOrg();
  const reviews = useReviewsApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { review: documentId }),
    queryFn: () => reviews.getReview(documentId!),
    enabled: documentId !== null,
  });
}

export function useDocumentComments(projectId: string, documentId: string | null) {
  const { orgId } = useCurrentOrg();
  const reviews = useReviewsApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { comments: documentId }),
    queryFn: () => reviews.comments(documentId!),
    enabled: documentId !== null,
  });
}

export function useOpenReviews(projectId: string, enabled: boolean, overdueOnly: boolean) {
  const { orgId } = useCurrentOrg();
  const reviews = useReviewsApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { openReviews: overdueOnly }),
    queryFn: () => reviews.openReviews(overdueOnly),
    enabled,
  });
}

export function useReviewSuggestions(
  projectId: string,
  documentId: string | null,
  enabled: boolean,
) {
  const { orgId } = useCurrentOrg();
  const reviews = useReviewsApi(projectId);
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'documents', { suggest: documentId }),
    queryFn: () => reviews.suggestions(documentId!),
    enabled: enabled && documentId !== null,
    staleTime: 60_000,
  });
}

/** Every change here can move the document's status, the open-review list and the comment counts, so refetch all. */
function useReviewMutation<V>(
  projectId: string,
  fn: (api: ReviewsApi, input: V) => Promise<unknown>,
) {
  const { orgId } = useCurrentOrg();
  const reviews = useReviewsApi(projectId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: V) => fn(reviews, input),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'documents') }),
  });
}

export const useStartReview = (projectId: string) =>
  useReviewMutation(projectId, (a, v: { documentId: string; input: StartReviewInput }) =>
    a.startReview(v.documentId, v.input),
  );
export const useCancelReview = (projectId: string) =>
  useReviewMutation(projectId, (a, documentId: string) => a.cancelReview(documentId));
export const useDecideStep = (projectId: string) =>
  useReviewMutation(
    projectId,
    (
      a,
      v: {
        documentId: string;
        stepId: string;
        decision: 'approved' | 'approved_with_comments' | 'rejected';
        note: string | null;
      },
    ) => a.decide(v.documentId, v.stepId, { decision: v.decision, note: v.note }),
  );
export const useReassignStep = (projectId: string) =>
  useReviewMutation(projectId, (a, v: { documentId: string; stepId: string; userId: string }) =>
    a.reassign(v.documentId, v.stepId, v.userId),
  );
export const useAddComment = (projectId: string) =>
  useReviewMutation(projectId, (a, v: { documentId: string; body: string; parentId?: string }) =>
    a.addComment(
      v.documentId,
      v.parentId ? { body: v.body, parentId: v.parentId } : { body: v.body },
    ),
  );
export const useResolveComment = (projectId: string) =>
  useReviewMutation(
    projectId,
    (a, v: { documentId: string; commentId: string; resolved: boolean; note?: string }) =>
      a.resolveComment(v.documentId, v.commentId, { resolved: v.resolved, note: v.note ?? null }),
  );
