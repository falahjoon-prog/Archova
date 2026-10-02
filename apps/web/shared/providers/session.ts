import { unwrap } from '@archova/api-client';
import { queryOptions } from '@tanstack/react-query';
import { api } from '../lib/api';

export const sessionQueryKey = ['auth', 'session'] as const;

export const sessionQuery = queryOptions({
  queryKey: sessionQueryKey,
  queryFn: async () => unwrap(await api.GET('/v1/auth/session')),
  staleTime: Infinity,
  retry: false,
  refetchOnWindowFocus: false,
  meta: { authRedirect: false },
});
