'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createDeliveriesApi,
  type ChangeDelivery,
  type CreateDelivery,
  type CreateResource,
  type NoticeRequest,
  type SlotRequest,
} from '../data/api';

function useDeliveriesApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createDeliveriesApi(orgId), [orgId]);
}

export function useResources(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useDeliveriesApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'deliveries', { view: 'resources' }),
    queryFn: () => source.resources(projectId),
  });
}

/** Deliveries whose window touches `[from, to]` (ISO instants). */
export function useDeliveries(projectId: string, from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useDeliveriesApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'deliveries', { view: 'list', from, to }),
    queryFn: () => source.list(projectId, from, to),
  });
}

export function useDeliveryDetail(projectId: string, deliveryId: string | null) {
  const { orgId } = useCurrentOrg();
  const source = useDeliveriesApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'deliveries', { view: 'detail', deliveryId }),
    queryFn: () => source.get(projectId, deliveryId!),
    enabled: deliveryId !== null,
  });
}

export function useDeliveryInsights(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useDeliveriesApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'deliveries', { view: 'insights' }),
    queryFn: () => source.insights(projectId),
    // The flags depend on the clock, so look again every few minutes while the board is open.
    refetchInterval: 5 * 60_000,
  });
}

export function useDeliveryMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useDeliveriesApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'deliveries') });
  return {
    create: useMutation({
      mutationFn: (body: CreateDelivery) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    createResource: useMutation({
      mutationFn: (body: CreateResource) => source.createResource(projectId, body),
      onSuccess: refresh,
    }),
    checkIn: useMutation({
      mutationFn: (v: { deliveryId: string; event: 'arrived' | 'unloaded' }) =>
        source.checkIn(projectId, v.deliveryId, v.event),
      onSuccess: refresh,
    }),
    change: useMutation({
      mutationFn: (v: { deliveryId: string; body: ChangeDelivery }) =>
        source.change(projectId, v.deliveryId, v.body),
      onSuccess: refresh,
    }),
    notice: useMutation({
      mutationFn: (v: { deliveryId: string; body: NoticeRequest }) =>
        source.notice(projectId, v.deliveryId, v.body),
      onSuccess: refresh,
    }),
    suggest: useMutation({
      mutationFn: (body: SlotRequest) => source.suggest(projectId, body),
    }),
  };
}
