'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/** What the user is looking at, so Nova can answer about it (ai/07 §2: the panel knows the current context). */
export interface AssistantScope {
  projectId?: string;
  /** The record on screen, e.g. `{ type: 'rfi', id: 'rfi_…' }`. */
  record?: { type: string; id: string };
}

const ScopeContext = createContext<{
  scope: AssistantScope;
  setScope: (s: AssistantScope) => void;
} | null>(null);

export function AssistantScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<AssistantScope>({});
  return <ScopeContext.Provider value={{ scope, setScope }}>{children}</ScopeContext.Provider>;
}

export function useAssistantScope(): AssistantScope {
  return useContext(ScopeContext)?.scope ?? {};
}

/** Screens call this to tell the panel what they show; the scope clears when the screen unmounts. */
export function usePublishAssistantScope(scope: AssistantScope) {
  const ctx = useContext(ScopeContext);
  const setScope = ctx?.setScope;
  const key = JSON.stringify(scope);
  useEffect(() => {
    if (!setScope) return;
    setScope(JSON.parse(key) as AssistantScope);
    return () => setScope({});
  }, [setScope, key]);
}
