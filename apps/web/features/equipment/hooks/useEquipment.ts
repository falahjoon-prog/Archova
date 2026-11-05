'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { queryKeys } from '@archova/query';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import {
  createEquipmentApi,
  type CreateBooking,
  type CreateEquipment,
  type EquipmentStatus,
  type LogHours,
} from '../data/api';

function useEquipmentApi() {
  const { orgId } = useCurrentOrg();
  return useMemo(() => createEquipmentApi(orgId), [orgId]);
}

export function useEquipmentList(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEquipmentApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'equipment', { view: 'register' }),
    queryFn: () => source.list(projectId),
  });
}

export function useEquipmentBookings(projectId: string, from: string, to: string) {
  const { orgId } = useCurrentOrg();
  const source = useEquipmentApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'equipment', { view: 'bookings', from, to }),
    queryFn: () => source.bookings(projectId, from, to),
  });
}

export function useEquipmentLogs(projectId: string, equipmentId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEquipmentApi();
  return useQuery({
    queryKey: queryKeys.toolList(orgId, projectId, 'equipment', { view: 'logs', equipmentId }),
    queryFn: () => source.logs(projectId, equipmentId),
    enabled: equipmentId !== '',
  });
}

export function useEquipmentMutations(projectId: string) {
  const { orgId } = useCurrentOrg();
  const source = useEquipmentApi();
  const qc = useQueryClient();
  const refresh = () =>
    qc.invalidateQueries({ queryKey: queryKeys.tool(orgId, projectId, 'equipment') });
  return {
    create: useMutation({
      mutationFn: (body: CreateEquipment) => source.create(projectId, body),
      onSuccess: refresh,
    }),
    setStatus: useMutation({
      mutationFn: (v: { equipmentId: string; status: EquipmentStatus }) =>
        source.setStatus(projectId, v.equipmentId, v.status),
      onSuccess: refresh,
    }),
    book: useMutation({
      mutationFn: (v: { equipmentId: string; body: CreateBooking }) =>
        source.book(projectId, v.equipmentId, v.body),
      onSuccess: refresh,
    }),
    cancelBooking: useMutation({
      mutationFn: (v: { equipmentId: string; bookingId: string }) =>
        source.cancelBooking(projectId, v.equipmentId, v.bookingId),
      onSuccess: refresh,
    }),
    logHours: useMutation({
      mutationFn: (v: { equipmentId: string; body: LogHours }) =>
        source.logHours(projectId, v.equipmentId, v.body),
      onSuccess: refresh,
    }),
  };
}
