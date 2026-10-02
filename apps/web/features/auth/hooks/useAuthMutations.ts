'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@archova/api-client';
import type { LoginRequest, SessionInfo, SignupRequest } from '@archova/contracts';
import { api, ensureCsrfToken, webSession } from '@/shared/lib/api';
import { sessionQueryKey } from '@/shared/providers/session';

/** A new session means a new user: drop everything cached for the previous one. */
function useStartSession() {
  const queryClient = useQueryClient();
  return (session: SessionInfo) => {
    queryClient.clear();
    queryClient.setQueryData(sessionQueryKey, session);
  };
}

export function useLogin() {
  const startSession = useStartSession();
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async (body: LoginRequest) => {
      // If a session cookie already exists, the API wants its CSRF token even on sign-in.
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/login', { body }));
    },
    onSuccess: startSession,
  });
}

export function useSignup() {
  const startSession = useStartSession();
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async (body: SignupRequest) => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/signup', { body }));
    },
    onSuccess: startSession,
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { authRedirect: false },
    mutationFn: async () => {
      await ensureCsrfToken();
      return unwrap(await api.POST('/v1/auth/logout'));
    },
    onSuccess: () => {
      webSession.setCsrfToken(null);
      queryClient.clear();
    },
  });
}
