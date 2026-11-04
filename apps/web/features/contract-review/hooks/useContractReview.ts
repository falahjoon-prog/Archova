'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createContractReviewApi,
  type ContractReview,
  type FlagDecisionKind,
  type StartReviewInput,
} from '../data/api';

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createContractReviewApi(orgId), [orgId]);
}

const key = (orgId: string, projectId: string, id?: string) =>
  ['contract-reviews', orgId, projectId, ...(id ? [id] : [])] as const;

export function useContractReviews(projectId: string, enabled = true) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({
    queryKey: key(orgId, projectId),
    queryFn: () => api.list(projectId),
    enabled,
  });
}

export function useContractReview(projectId: string, suggestionId: string) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  return useQuery({
    queryKey: key(orgId, projectId, suggestionId),
    queryFn: () => api.get(projectId, suggestionId),
  });
}

/** Starting a review and deciding a flag are ordinary mutations, not optimistic (frontend 12 §2). */
export function useContractReviewMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const api = useApi();
  const qc = useQueryClient();
  const saved = (r: ContractReview) => {
    qc.setQueryData(key(orgId, projectId, r.suggestionId), r);
    void qc.invalidateQueries({ queryKey: key(orgId, projectId), exact: true });
  };
  const start = useMutation({
    mutationFn: (input: StartReviewInput) => api.start(projectId, input),
    onSuccess: saved,
  });
  const decide = useMutation({
    mutationFn: (v: {
      suggestionId: string;
      flagIndex: number;
      decision: FlagDecisionKind;
      note: string | null;
    }) =>
      api.decide(projectId, v.suggestionId, v.flagIndex, { decision: v.decision, note: v.note }),
    onSuccess: saved,
  });
  return { start, decide };
}

/** Asking is a plain mutation: nothing is saved by the server, so the screen keeps the questions it shows. */
export function useAskContract(projectId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (v: { suggestionId: string; question: string }) =>
      api.ask(projectId, v.suggestionId, v.question),
  });
}

/** Comparing is a plain mutation too: the result lives on the Compare tab until it is closed. */
export function useCompareContracts(projectId: string) {
  const api = useApi();
  return useMutation({
    mutationFn: (v: { baseReviewId: string; otherReviewId: string }) =>
      api.compare(projectId, v.baseReviewId, v.otherReviewId),
  });
}

export function useRateAnswer() {
  const api = useApi();
  return useMutation({
    mutationFn: (v: { runId: string; rating: 'up' | 'down' }) => api.rate(v.runId, v.rating),
  });
}
