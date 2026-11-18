'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { ErrorView } from '../lib/errors';

type AskForHelp = (error: ErrorView) => void;

const ErrorHelpContext = createContext<AskForHelp | null>(null);

/** Lets the shared error alert offer "Ask Nova what to do" without the shared layer knowing about the assistant. */
export function ErrorHelpProvider({
  onAskHelp,
  children,
}: {
  onAskHelp: AskForHelp;
  children: ReactNode;
}) {
  return <ErrorHelpContext.Provider value={onAskHelp}>{children}</ErrorHelpContext.Provider>;
}

/** Null outside a signed-in organisation, where there is no Nova to ask. */
export function useErrorHelp(): AskForHelp | null {
  return useContext(ErrorHelpContext);
}
