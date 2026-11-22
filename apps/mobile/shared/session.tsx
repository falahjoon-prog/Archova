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
  /** `fresh` makes the person enter their password again, for actions that need a recent sign-in. */
  signIn: (opts?: { fresh?: boolean }) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  /** Why the last sign-in did not finish. Kept here, not in the screen, because the return link from the browser
   *  can remount the sign-in screen before the result arrives. */
  signInError: string | null;
  /** Called when the API rejects the refresh token (401 after refresh). */
  markSignedOut: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [signInError, setSignInError] = useState<string | null>(null);

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

  const signIn = useCallback(async (opts?: { fresh?: boolean }) => {
    setSignInError(null);
    try {
      const result = await signInWithPkce(
        {
          appOrigin: appConfig.appOrigin,
          randomBytes,
          sha256,
          openAuthSession: (url, redirectUri) => WebBrowser.openAuthSessionAsync(url, redirectUri),
          exchangeCode: session.exchangeCode,
        },
        opts?.fresh ? { prompt: 'login' } : {},
      );
      if (result.status === 'signed_in') setStatus('signed_in');
      else if (result.status === 'error') setSignInError(result.message);
      return result;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSignInError(`Could not complete sign-in: ${detail}`);
      throw error;
    }
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
    () => ({ status, signIn, signOut, signInError, markSignedOut }),
    [status, signIn, signOut, signInError, markSignedOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
