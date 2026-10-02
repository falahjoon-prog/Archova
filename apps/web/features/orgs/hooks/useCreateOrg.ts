'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type { CreateOrgRequest } from '@archova/contracts';
import { queryKeys } from '@archova/query';
import { api, ensureCsrfToken } from '@/shared/lib/api';

/** POST /v1/orgs. The caller becomes owner, so their memberships (GET /v1/me) change. */
export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateOrgRequest) => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/orgs', { body }));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.me() }),
  });
}
