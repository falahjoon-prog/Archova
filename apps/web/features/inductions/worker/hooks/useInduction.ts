'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { createInductionAccessApi } from '../data/api';
import type { InductionSource } from '../data/contract';
import { inductionSource as previewSource } from '../data/source';
import type { InductionProgress, OpenInduction, OpenedInduction } from '../lib/types';

/**
 * Preview-only stand-in for the `__Host-lnk` cookie the API sets when it exchanges the link (frontend 11 §3). The
 * token itself is never stored; only the session id, for this tab.
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

/** One source per page load: it holds the details typed on B2 between sending the code and verifying it. */
let apiSource: InductionSource | null = null;
export function useInductionSource(): InductionSource {
  if (previewDataOnly) return previewSource;
  return (apiSource ??= createInductionAccessApi());
}

/** Takes the token out of the address bar so it isn't shared by screenshot, copy-paste or the Referer header. */
function stripToken() {
  if (window.location.pathname !== '/i/continue')
    window.history.replaceState(window.history.state, '', `/i/continue${window.location.search}`);
}

/** Opens the link once and keeps the session. The token is gone from the URL whether or not the link worked. */
export function useOpenInduction(token: string) {
  const source = useInductionSource();
  const query = useQuery({
    queryKey: inductionKey,
    queryFn: async () => {
      try {
        return await source.open(token, readSession());
      } finally {
        stripToken();
      }
    },
    staleTime: Infinity,
    retry: false,
  });
  const data = query.data;
  useEffect(() => {
    if (!previewDataOnly || data?.state !== 'open') return;
    try {
      sessionStorage.setItem(SESSION_KEY, data.sessionId);
    } catch {
      // Private mode: the session lasts for this page only.
    }
  }, [data]);
  return query;
}

export function setProgress(qc: QueryClient, progress: InductionProgress) {
  qc.setQueryData<OpenedInduction>(inductionKey, (old) =>
    old?.state === 'open' ? { ...old, progress } : old,
  );
}

/** Verifying releases the content, so the whole opened induction is replaced, not only the progress. */
export function setOpened(qc: QueryClient, opened: OpenInduction) {
  qc.setQueryData<OpenedInduction>(inductionKey, opened);
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
