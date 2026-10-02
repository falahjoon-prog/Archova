'use client';

import { useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { webRoutes } from '@archova/routes';
import { isApiError } from '../lib/errors';
import { SessionBootstrap } from './SessionBootstrap';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { authRedirect?: boolean };
    mutationMeta: { authRedirect?: boolean };
  }
}

/** frontend 04 §3: a 401 sends the user to sign-in with `next` set. */
function redirectToSignIn() {
  if (typeof window === 'undefined') return;
  const here = `${window.location.pathname}${window.location.search}`;
  if (window.location.pathname === webRoutes.login()) return;
  window.location.assign(webRoutes.login(here));
}

function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isApiError(error, 401) && query.meta?.authRedirect !== false) redirectToSignIn();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => {
        if (isApiError(error, 401) && mutation.meta?.authRedirect !== false) redirectToSignIn();
      },
    }),
    defaultOptions: {
      // frontend 02 §2: 30 s for lists, 5 min gc, retry GETs twice (never 4xx), never retry mutations.
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) => {
          if (isApiError(error) && error.status < 500 && error.status !== 429) return false;
          return failureCount < 2;
        },
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <SessionBootstrap />
      {children}
    </QueryClientProvider>
  );
}
