'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { useMemo } from 'react';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createQuotesApi } from '../data/quotes-api';
import { quotesSource as previewSource, type QuotesSource } from '../data/quotes-source';
import type { NegotiateTopic } from '../lib/negotiate';
import type { PackageAction, ScopeLine } from '../lib/quote-types';

/** The API once the estimating endpoints are reachable; the in-browser preview store in preview mode and tests. */
export function useQuotesSource(): QuotesSource {
  const { orgId } = useCurrentOrg();
  return useMemo(() => (previewDataOnly ? previewSource : createQuotesApi(orgId)), [orgId]);
}

export function usePackages() {
  const quotesSource = useQuotesSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'tender-packages'),
    queryFn: () => quotesSource.listPackages(projectId),
  });
}

export function usePackage(packageId: string) {
  const quotesSource = useQuotesSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'tender-packages', packageId),
    queryFn: () => quotesSource.getPackage(projectId, packageId),
  });
}

/** Polls while Nova is still reading a quote, so "reading" turns into "ready to review" on its own. */
export function useQuotes(packageId: string) {
  const quotesSource = useQuotesSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'tender-packages', { packageId, quotes: true }),
    queryFn: () => quotesSource.listQuotes(projectId, packageId),
    refetchInterval: (q) => (q.state.data?.some((x) => x.status === 'reading') ? 1000 : false),
  });
}

/** Award and confirm wait for the server; allowances and corrections are small, but still server-first. */
export function usePackageMutations(packageId: string) {
  const quotesSource = useQuotesSource();
  const { orgId } = useCurrentOrg();
  const { projectId, timezone } = useCurrentProject();
  const actor = useActor();
  const qc = useQueryClient();
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'tender-packages') });
  return {
    addScope: useMutation({
      mutationFn: (lines: ScopeLine[]) => quotesSource.addScopeLines(projectId, packageId, lines),
      onSuccess: invalidate,
    }),
    invite: useMutation({
      mutationFn: (v: { companyIds: string[]; overrideReason?: string }) =>
        quotesSource.invite(projectId, packageId, v.companyIds, v.overrideReason),
      onSuccess: invalidate,
    }),
    resend: useMutation({
      mutationFn: (companyId: string) => quotesSource.resendInvite(projectId, packageId, companyId),
      onSuccess: invalidate,
    }),
    upload: useMutation({
      mutationFn: (v: { companyId: string; file: File }) =>
        quotesSource.uploadQuote(projectId, packageId, v),
      onSuccess: invalidate,
    }),
    correct: useMutation({
      mutationFn: (v: { quoteId: string; lineId: string; amountCents: number }) =>
        quotesSource.correctLine(projectId, packageId, v.quoteId, v.lineId, v.amountCents),
      onSuccess: invalidate,
    }),
    confirm: useMutation({
      mutationFn: (quoteId: string) =>
        quotesSource.confirmQuote(projectId, packageId, quoteId, actor),
      onSuccess: invalidate,
    }),
    decline: useMutation({
      mutationFn: (quoteId: string) => quotesSource.declineQuote(projectId, packageId, quoteId),
      onSuccess: invalidate,
    }),
    transition: useMutation({
      mutationFn: (action: PackageAction) => quotesSource.transition(projectId, packageId, action),
      onSuccess: invalidate,
    }),
    subcontract: useMutation({
      mutationFn: () => quotesSource.createSubcontract(projectId, packageId),
    }),
    commitment: useMutation({
      mutationFn: (budgetLineId: string) =>
        quotesSource.createCommitment(projectId, packageId, budgetLineId),
    }),
    allowance: useMutation({
      mutationFn: (v: { quoteId: string; scopeKey: string; cents: number | null }) =>
        quotesSource.setAllowance(projectId, packageId, v.quoteId, v.scopeKey, v.cents),
      onSuccess: invalidate,
    }),
    award: useMutation({
      mutationFn: (v: { quoteId: string; reason: string }) =>
        quotesSource.award(projectId, packageId, v.quoteId, v.reason, actor, todayIn(timezone)),
      onSuccess: invalidate,
    }),
  };
}

export function useCreatePackage() {
  const quotesSource = useQuotesSource();
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { name: string; trade: string; dueAt: string }) =>
      quotesSource.createPackage(projectId, v),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'tender-packages') }),
  });
}

/** Nova's help on one confirmed quote. Nothing is saved, so no cache is touched. */
export function useNegotiate(packageId: string) {
  const quotesSource = useQuotesSource();
  const { projectId, timezone } = useCurrentProject();
  return useMutation({
    mutationFn: (v: {
      quoteId: string;
      targetCents: number | null;
      topic: NegotiateTopic;
      question?: string;
    }) => quotesSource.askNova(projectId, packageId, { ...v, today: todayIn(timezone) }),
  });
}

/** Nova listening: a short recording in, the words out for the person to read and edit. Nothing is kept. */
export function useListen() {
  const quotesSource = useQuotesSource();
  const { projectId } = useCurrentProject();
  return useMutation({ mutationFn: (clip: Blob) => quotesSource.listen(projectId, clip) });
}
