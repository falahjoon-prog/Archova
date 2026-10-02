'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@archova/query';
import { todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { quotesSource } from '../data/quotes-source';
import type { ScopeLine } from '../lib/quote-types';

export function usePackages() {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'tender-packages'),
    queryFn: () => quotesSource.listPackages(projectId),
  });
}

export function usePackage(packageId: string) {
  const { orgId } = useCurrentOrg();
  const { projectId } = useCurrentProject();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'tender-packages', packageId),
    queryFn: () => quotesSource.getPackage(projectId, packageId),
  });
}

/** Polls while Nova is still reading a quote, so "reading" turns into "ready to review" on its own. */
export function useQuotes(packageId: string) {
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
      mutationFn: (companyIds: string[]) => quotesSource.invite(projectId, packageId, companyIds),
      onSuccess: invalidate,
    }),
    upload: useMutation({
      mutationFn: (v: { companyId: string; fileName: string }) =>
        quotesSource.uploadQuote(projectId, packageId, v),
      onSuccess: invalidate,
    }),
    correct: useMutation({
      mutationFn: (v: { quoteId: string; lineId: string; amountCents: number }) =>
        quotesSource.correctLine(projectId, v.quoteId, v.lineId, v.amountCents),
      onSuccess: invalidate,
    }),
    confirm: useMutation({
      mutationFn: (quoteId: string) => quotesSource.confirmQuote(projectId, quoteId, actor),
      onSuccess: invalidate,
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
