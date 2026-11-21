// Review matrix and comment threads against the documents module (document control). API only: there is no
// preview source, so the panel shows a notice while preview data is on.

import { unwrap } from '@archova/api-client';
import type {
  DocumentCommentList,
  DocumentReviewState,
  OpenDocumentReview,
  ReviewerSuggestion,
} from '@archova/contracts';
import { api, ensureCsrfToken } from '@/shared/lib/api';

type P = { orgId: string; projectId: string };
const doc = (p: P, documentId: string) => ({ path: { ...p, documentId } });

export interface StartReviewInput {
  mode: 'sequential' | 'parallel';
  dueAt: string | null;
  note: string | null;
  steps: Array<{ userId: string; role: 'reviewer' | 'approver'; order: number }>;
}

export function createReviewsApi(p: P) {
  const base = '/v1/orgs/{orgId}/projects/{projectId}/documents/{documentId}';
  return {
    async getReview(documentId: string): Promise<DocumentReviewState> {
      return unwrap(await api.GET(`${base}/review`, { params: doc(p, documentId) }));
    },
    async startReview(documentId: string, body: StartReviewInput): Promise<DocumentReviewState> {
      await ensureCsrfToken();
      return unwrap(await api.POST(`${base}/review`, { params: doc(p, documentId), body }));
    },
    async cancelReview(documentId: string): Promise<DocumentReviewState> {
      await ensureCsrfToken();
      return unwrap(await api.POST(`${base}/review/cancel`, { params: doc(p, documentId) }));
    },
    async decide(
      documentId: string,
      stepId: string,
      body: { decision: 'approved' | 'approved_with_comments' | 'rejected'; note: string | null },
    ): Promise<DocumentReviewState> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${base}/review/steps/{stepId}/decision`, {
          params: { path: { ...p, documentId, stepId } },
          body,
        }),
      );
    },
    async reassign(
      documentId: string,
      stepId: string,
      userId: string,
    ): Promise<DocumentReviewState> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${base}/review/steps/{stepId}/reassign`, {
          params: { path: { ...p, documentId, stepId } },
          body: { userId },
        }),
      );
    },
    async suggestions(documentId: string): Promise<ReviewerSuggestion[]> {
      return unwrap(await api.GET(`${base}/review-suggestions`, { params: doc(p, documentId) }))
        .data;
    },
    async openReviews(overdueOnly: boolean): Promise<OpenDocumentReview[]> {
      return unwrap(
        await api.GET('/v1/orgs/{orgId}/projects/{projectId}/document-reviews', {
          params: { path: p, query: overdueOnly ? { overdue: 'true' as const } : {} },
        }),
      ).data;
    },
    async comments(documentId: string): Promise<DocumentCommentList> {
      return unwrap(await api.GET(`${base}/comments`, { params: doc(p, documentId) }));
    },
    async addComment(
      documentId: string,
      body: { body: string; parentId?: string },
    ): Promise<DocumentCommentList> {
      await ensureCsrfToken();
      return unwrap(await api.POST(`${base}/comments`, { params: doc(p, documentId), body }));
    },
    async resolveComment(
      documentId: string,
      commentId: string,
      body: { resolved: boolean; note?: string | null },
    ): Promise<DocumentCommentList> {
      await ensureCsrfToken();
      return unwrap(
        await api.POST(`${base}/comments/{commentId}/resolution`, {
          params: { path: { ...p, documentId, commentId } },
          body,
        }),
      );
    },
  };
}

export type ReviewsApi = ReturnType<typeof createReviewsApi>;
