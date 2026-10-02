// Currently selected organisation and project. The org always comes from the URL path on the API (ADR-0004 §2: no
// org claim in the token), so screens read it from here to build `/v1/orgs/{orgId}/...` requests. The project is
// the one the header switcher shows; capture screens file new items against it.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface OrgContextValue {
  orgId: string | null;
  setOrgId: (orgId: string | null) => void;
  projectId: string | null;
  setProjectId: (projectId: string | null) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ orgId: string | null; projectId: string | null }>({
    orgId: null,
    projectId: null,
  });
  // A project belongs to one organisation, so switching organisation clears it.
  const setOrgId = useCallback(
    (orgId: string | null) => setState((s) => (s.orgId === orgId ? s : { orgId, projectId: null })),
    [],
  );
  const setProjectId = useCallback(
    (projectId: string | null) => setState((s) => ({ ...s, projectId })),
    [],
  );
  const value = useMemo(
    () => ({ ...state, setOrgId, setProjectId }),
    [state, setOrgId, setProjectId],
  );
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useCurrentOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useCurrentOrg must be used inside <OrgProvider>');
  return ctx;
}
