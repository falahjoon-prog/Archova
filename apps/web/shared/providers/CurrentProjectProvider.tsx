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
  /** The caller's company on this project (from the permissions summary); scopes company markups and subbie views. */
  companyId: string | null;
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

/** The project when inside the project layout, otherwise null (for org-level pieces such as the Nova panel). */
export function useOptionalCurrentProject(): CurrentProject | null {
  return useContext(CurrentProjectContext);
}
