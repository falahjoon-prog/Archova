'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CurrentProject {
  projectId: string;
  name: string;
  number: string | null;
  /** IANA time zone; every date and time on project screens is shown in it (conventions §Time, X34). */
  timezone: string;
  /** AU state or territory; drives business days and public holidays. */
  state: string | null;
}

const CurrentProjectContext = createContext<CurrentProject | null>(null);

/** Set by the project layout once the project has loaded (frontend 03 §2). */
export function CurrentProjectProvider({
  project,
  children,
}: {
  project: CurrentProject;
  children: ReactNode;
}) {
  return (
    <CurrentProjectContext.Provider value={project}>{children}</CurrentProjectContext.Provider>
  );
}

export function useCurrentProject(): CurrentProject {
  const project = useContext(CurrentProjectContext);
  if (!project) throw new Error('useCurrentProject must be used inside the project layout');
  return project;
}
