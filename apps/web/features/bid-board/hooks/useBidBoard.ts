'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { createBidBoardApi } from '../data/api';
import type { PackageStatus } from '../lib/types';

export function useBidBoard(f: { status?: PackageStatus; trade?: string }) {
  const { orgId } = useCurrentOrg();
  const api = useMemo(() => createBidBoardApi(orgId), [orgId]);
  return useQuery({
    queryKey: ['orgs', orgId, 'bid-board', { ...f }],
    queryFn: () => api.board(f),
  });
}
