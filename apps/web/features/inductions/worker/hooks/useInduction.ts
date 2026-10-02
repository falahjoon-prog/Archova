'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { inductionSource } from '../data/source';
import type { InductionProgress, OpenedInduction } from '../lib/types';

/**
 * Stand-in for the scoped guest session cookie the API sets when it exchanges the link (frontend 11 §3). The token
 * itself is never stored; only the session id, for this tab.
 */
const SESSION_KEY = 'archova.induction.session';

function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export const inductionKey = ['induction'] as const;

/** Opens the link once, keeps the session, and takes the token out of the address bar. */
export function useOpenInduction(token: string) {
  const query = useQuery({
    queryKey: inductionKey,
    queryFn: () => inductionSource.open(token, readSession()),
    staleTime: Infinity,
    retry: false,
  });
  const data = query.data;
  useEffect(() => {
    if (data?.state !== 'open') return;
    try {
      sessionStorage.setItem(SESSION_KEY, data.sessionId);
    } catch {
      // Private mode: the session lasts for this page only.
    }
    if (token !== 'continue') {
      // Not left in the URL to be shared by screenshot or copy-paste.
      window.history.replaceState(window.history.state, '', `/i/continue${window.location.search}`);
    }
  }, [data, token]);
  return query;
}

export function setProgress(qc: QueryClient, progress: InductionProgress) {
  qc.setQueryData<OpenedInduction>(inductionKey, (old) =>
    old?.state === 'open' ? { ...old, progress } : old,
  );
}

/** Every save returns the server's progress, which replaces ours: the server decides what's complete. */
export function useProgressMutation<A>(
  fn: (sessionId: string, args: A) => Promise<InductionProgress>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, args }: { sessionId: string; args: A }) => fn(sessionId, args),
    onSuccess: (progress) => setProgress(qc, progress),
    // Paused while offline and retried when the connection is back (frontend 11 §4).
    retry: (count, error) => count < 2 && !(error instanceof Error && 'status' in error),
  });
}

/** Tracks the connection so the screen can say progress is safe while offline. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}
