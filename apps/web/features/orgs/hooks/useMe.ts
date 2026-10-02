'use client';

import { useQuery } from '@tanstack/react-query';
import { queries } from '@/shared/lib/api';

/** GET /v1/me: the user and every org they can open. */
export function useMe() {
  return useQuery({ ...queries.me(), staleTime: 60_000 });
}
