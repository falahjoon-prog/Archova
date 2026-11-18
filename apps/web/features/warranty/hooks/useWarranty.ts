'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createWarrantyApi, type CreateWarrantyItem, type UpdateWarrantyItem } from '../data/api';

function useWarrantyApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createWarrantyApi(orgId), [orgId]);
}

export function useWarrantyItems(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useWarrantyApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'defects', { view: 'warranty' }),
    queryFn: () => source.list(projectId),
  });
}

export function useWarrantySummary(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useWarrantyApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'defects', { view: 'warranty-summary' }),
    queryFn: () => source.summary(projectId),
  });
}

export function useWarrantyClaims(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useWarrantyApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'defects', { view: 'warranty-claims' }),
    queryFn: () => source.claims(projectId),
  });
}

export function useWarrantyItem(projectId: string, itemId: string) {
  const { orgId } = useCurrentOrg();
  const source = useWarrantyApi();
  return useQuery({
    queryKey: queryKeys.toolItem(orgId, projectId, 'defects', `warranty:${itemId}`),
    queryFn: () => source.get(projectId, itemId),
  });
}

export function useWarrantyMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useWarrantyApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'defects') });
  return {
    create: useMutation({
      mutationFn: (body: CreateWarrantyItem) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (a: { itemId: string; version: number; body: UpdateWarrantyItem }) =>
        source.update(projectId, a.itemId, a.version, a.body),
      onSuccess: refresh,
    }),
    remove: useMutation({
      mutationFn: (a: { itemId: string; version: number }) =>
        source.remove(projectId, a.itemId, a.version),
      onSuccess: refresh,
    }),
  };
}
