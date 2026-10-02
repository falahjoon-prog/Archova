// Session provider: tracks whether a refresh token exists and exposes sign-in / sign-out to screens.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import * as WebBrowser from 'expo-web-browser';
import { ApiError } from '@archova/api-client';
import { session } from '../lib/api';
import { appConfig } from '../lib/env';
import { randomBytes, sha256 } from '../lib/platform/crypto';
import { signInWithPkce, type SignInResult } from '../lib/auth/sign-in-flow';

// Closes the auth popup on web if the redirect lands in a new tab; a no-op on native.
WebBrowser.maybeCompleteAuthSession();

export type SessionStatus = 'loading' | 'signed_in' | 'signed_out';

interface SessionContextValue {
  status: SessionStatus;
  signIn: () => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Called when the API rejects the refresh token (401 after refresh). */
  markSignedOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');

  useEffect(() => {
    let alive = true;
    session
      .isSignedIn()
      .then((signedIn) => alive && setStatus(signedIn ? 'signed_in' : 'signed_out'))
      .catch(() => alive && setStatus('signed_out'));
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async () => {
    const result = await signInWithPkce({
      appOrigin: appConfig.appOrigin,
      randomBytes,
      sha256,
      openAuthSession: (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri),
      exchangeCode: session.exchangeCode,
    });
    if (result.status === 'signed_in') setStatus('signed_in');
    return result;
  }, []);

  const signOut = useCallback(async () => {
    await session.signOut();
    queryClient.clear();
    setStatus('signed_out');
  }, [queryClient]);

  const markSignedOut = useCallback(() => {
    queryClient.clear();
    setStatus('signed_out');
  }, [queryClient]);

  // A 401 that survives the middleware's refresh-and-retry means the refresh token is gone or revoked.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const err = event.action.error;
        if (err instanceof ApiError && err.status === 401) markSignedOut();
      }),
    [queryClient, markSignedOut],
  );

  const value = useMemo(
    () => ({ status, signIn, signOut, markSignedOut }),
    [status, signIn, signOut, markSignedOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
