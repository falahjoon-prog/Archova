'use client';

import type { ErrorView } from '@/shared/lib/errors';
import { ErrorHelpProvider } from '@/shared/providers/ErrorHelpProvider';
import { useOptionalCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/** What the user is looking at, so Nova can answer about it (ai/07 §3: the panel knows the current context). */
export interface AssistantScope {
  projectId?: string;
  /** Added from the project layout so answers use the project's "today" (conventions §Time). */
  projectName?: string;
  timezone?: string;
  /** The record on screen, e.g. `{ type: 'rfi', id: 'rfi_…', label: 'RFI-003' }`. */
  record?: { type: string; id: string; label?: string };
  /** Totals the register shows (unfiltered), so the panel can offer starters about what is open or overdue. */
  counts?: { open?: number; overdue?: number; review?: number };
}

interface AssistantContextValue {
  scope: AssistantScope;
  setScope: (s: AssistantScope) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Set by "Ask Nova about this"; the panel focuses its input when it changes. */
  focusRequest: number;
  requestFocus: () => void;
  /** Screens register what chat may do for them ("draft"); the panel runs it so chat and the screen stay in sync. */
  /** An error the person asked Nova about; the panel answers it once and clears it. */
  pendingError: ErrorView | null;
  askAboutError: (error: ErrorView) => void;
  clearPendingError: () => void;
  registerAction: (id: string, run: () => void) => () => void;
  runAction: (id: string) => boolean;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

/**
 * Mounted once by the org layout, so the panel's open state and scope survive navigation (frontend 03 §5). The
 * conversation lives in the panel, which stays mounted while hidden.
 */
export function AssistantScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<AssistantScope>({});
  const [open, setOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const requestFocus = useCallback(() => {
    setOpen(true);
    setFocusRequest((n) => n + 1);
  }, []);
  const [pendingError, setPendingError] = useState<ErrorView | null>(null);
  const askAboutError = useCallback((error: ErrorView) => {
    setOpen(true);
    setPendingError(error);
  }, []);
  const clearPendingError = useCallback(() => setPendingError(null), []);
  const actions = useRef(new Map<string, () => void>());
  const registerAction = useCallback((id: string, run: () => void) => {
    actions.current.set(id, run);
    return () => {
      if (actions.current.get(id) === run) actions.current.delete(id);
    };
  }, []);
  const runAction = useCallback((id: string) => {
    const run = actions.current.get(id);
    run?.();
    return Boolean(run);
  }, []);
  const value = useMemo(
    () => ({
      scope,
      setScope,
      open,
      setOpen,
      focusRequest,
      requestFocus,
      pendingError,
      askAboutError,
      clearPendingError,
      registerAction,
      runAction,
    }),
    [
      scope,
      open,
      focusRequest,
      requestFocus,
      pendingError,
      askAboutError,
      clearPendingError,
      registerAction,
      runAction,
    ],
  );
  return (
    <AssistantContext.Provider value={value}>
      <ErrorHelpProvider onAskHelp={askAboutError}>{children}</ErrorHelpProvider>
    </AssistantContext.Provider>
  );
}

export function useAssistantScope(): AssistantScope {
  return useContext(AssistantContext)?.scope ?? {};
}

/** Panel open state for the app shell toggle and `Cmd/Ctrl+J`. */
export function useAssistantPanelState() {
  const ctx = useContext(AssistantContext);
  return {
    open: ctx?.open ?? false,
    setOpen: ctx?.setOpen ?? (() => undefined),
    focusRequest: ctx?.focusRequest ?? 0,
    pendingError: ctx?.pendingError ?? null,
    clearPendingError: ctx?.clearPendingError ?? (() => undefined),
  };
}

/** "Ask Nova about this" on a record: opens the panel with the record in scope and the cursor in the box. */
export function useAskNova() {
  return useContext(AssistantContext)?.requestFocus ?? (() => undefined);
}

/** Screens call this to tell the panel what they show; the scope clears when the screen unmounts. */
export function usePublishAssistantScope(scope: AssistantScope) {
  const ctx = useContext(AssistantContext);
  const setScope = ctx?.setScope;
  const project = useOptionalCurrentProject();
  const withProject =
    project && scope.projectId === project.projectId
      ? { ...scope, projectName: project.name, timezone: project.timezone }
      : scope;
  const key = JSON.stringify(withProject);
  useEffect(() => {
    if (!setScope) return;
    setScope(JSON.parse(key) as AssistantScope);
    return () => setScope({});
  }, [setScope, key]);
}

/** Lets chat start an action on the current screen, e.g. "Draft with Nova" on an induction. */
export function useRegisterAssistantAction(id: string, run: () => void) {
  const register = useContext(AssistantContext)?.registerAction;
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => register?.(id, () => latest.current()), [register, id]);
}

export function useRunAssistantAction() {
  return useContext(AssistantContext)?.runAction ?? (() => false);
}
