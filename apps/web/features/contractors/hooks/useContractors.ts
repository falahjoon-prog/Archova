'use client';

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  contractorApi,
  createCompanyContractorsApi,
  type ContractorLinkStatus,
  type ContractorProfileInput,
} from '../data/api';

const mine = ['contractor'] as const;

export function useContractorProfile() {
  return useQuery({ queryKey: [...mine, 'profile'], queryFn: () => contractorApi.profile() });
}

export function useSaveContractorProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContractorProfileInput) => contractorApi.saveProfile(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: [...mine, 'profile'] }),
  });
}

/** Search runs only for 3 or more characters, so a half-typed name never calls the API. */
export function useCompanySearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: [...mine, 'search', term],
    queryFn: () => contractorApi.searchCompanies(term),
    enabled: term.length >= 3,
    staleTime: 15_000,
  });
}

export function useMyLinks(q: string) {
  return useInfiniteQuery({
    queryKey: [...mine, 'links', q.trim()],
    queryFn: ({ pageParam }) =>
      contractorApi.links({ q: q.trim(), ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useRequestLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (listingId: string) => contractorApi.request(listingId),
    onSuccess: () => qc.invalidateQueries({ queryKey: mine }),
  });
}

export function useRemoveMyLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => contractorApi.remove(linkId),
    onSuccess: () => qc.invalidateQueries({ queryKey: mine }),
  });
}

export function useCompanyContractors(status: ContractorLinkStatus) {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createCompanyContractorsApi(orgId), [orgId]);
  return {
    source,
    query: useInfiniteQuery({
      queryKey: ['orgs', orgId, 'contractors', status],
      queryFn: ({ pageParam }) =>
        source.list({ status, ...(pageParam ? { cursor: pageParam } : {}) }),
      initialPageParam: '',
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  };
}

export function useDecideContractor() {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createCompanyContractorsApi(orgId), [orgId]);
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['orgs', orgId, 'contractors'] });
  return {
    accept: useMutation({ mutationFn: (id: string) => source.accept(id), onSuccess: done }),
    block: useMutation({ mutationFn: (id: string) => source.block(id), onSuccess: done }),
    reject: useMutation({ mutationFn: (id: string) => source.reject(id), onSuccess: done }),
    end: useMutation({ mutationFn: (id: string) => source.end(id), onSuccess: done }),
  };
}

/** Whether contractors can find this company by name (off until the company opts in). */
export function useContractorListing() {
  const { orgId } = useCurrentOrg();
  const source = useMemo(() => createCompanyContractorsApi(orgId), [orgId]);
  const qc = useQueryClient();
  const key = ['orgs', orgId, 'contractor-listing'];
  return {
    query: useQuery({ queryKey: key, queryFn: () => source.listing() }),
    set: useMutation({
      mutationFn: (listed: boolean) => source.setListing(listed),
      onSuccess: (listed) => qc.setQueryData(key, listed),
    }),
  };
}
