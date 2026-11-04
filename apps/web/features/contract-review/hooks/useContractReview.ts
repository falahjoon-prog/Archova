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
