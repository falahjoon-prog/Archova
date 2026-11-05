'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { unwrap } from '@archova/api-client';
import { api } from '@/shared/lib/api';
import { allPages } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createBiddersApi, type BidderList, type BidderListInput } from '../data/bidders-api';

const key = (orgId: string) => ['orgs', orgId, 'bidder-lists'] as const;

function useApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createBiddersApi(orgId), [orgId]);
}

/** Staff only. Callers inside preview-data screens pass `enabled: false`, since preview data has no lists. */
export function useBidderLists({ enabled = true }: { enabled?: boolean } = {}) {
  const { orgId } = useCurrentOrg();
  const lists = useApi();
  return useQuery({
    queryKey: key(orgId),
    queryFn: () => lists.list(),
    enabled,
  });
}

/** Every subcontractor company in the directory, for choosing who goes on a list. */
export function useSubcontractorCompanies() {
  const { orgId } = useCurrentOrg();
  return useQuery({
    queryKey: ['directory', orgId, 'subcontractor-companies'],
    queryFn: async () =>
      (
        await allPages(async (cursor) =>
          unwrap(
            await api.GET('/v1/orgs/{orgId}/companies', {
              params: { path: { orgId }, query: { limit: 200, cursor } },
            }),
          ),
        )
      )
        .filter((c) => c.type === 'subcontractor')
        .sort((a, b) => a.name.localeCompare(b.name)),
    staleTime: 5 * 60_000,
  });
}

export function useBidderListMutations() {
  const { orgId } = useCurrentOrg();
  const lists = useApi();
  const qc = useQueryClient();
  // Wait for the refetch so the next edit never sends a stale version.
  const settle = async <T>(v: T) => {
    await qc.invalidateQueries({ queryKey: key(orgId) });
    return v;
  };
  return {
    create: useMutation({
      mutationFn: async (body: BidderListInput) => settle(await lists.create(body)),
    }),
    update: useMutation({
      mutationFn: async (v: { list: BidderList; body: BidderListInput }) =>
        settle(await lists.update(v.list, v.body)),
    }),
    remove: useMutation({
      mutationFn: async (list: BidderList) => settle(await lists.remove(list)),
    }),
  };
}
