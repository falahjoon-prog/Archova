// Currently selected organisation. The org always comes from the URL path on the API (ADR-0004 §2: no org claim in
// the token), so screens read it from here to build `/v1/orgs/{orgId}/...` requests.
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface OrgContextValue {
  orgId: string | null;
  setOrgId: (orgId: string | null) => void;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const [orgId, setOrgId] = useState<string | null>(null);
  const value = useMemo(() => ({ orgId, setOrgId }), [orgId]);
  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useCurrentOrg(): OrgContextValue {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useCurrentOrg must be used inside <OrgProvider>');
  return ctx;
}
