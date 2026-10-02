'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CurrentOrg {
  orgId: string;
  orgSlug: string;
  orgName: string;
  role: 'owner' | 'admin' | 'billing_admin' | 'member' | null;
  kind: 'member' | 'external';
  /** The signed-in user, for "assigned to me" views and the actor on records. */
  user: { id: string; name: string };
}

const CurrentOrgContext = createContext<CurrentOrg | null>(null);

/** Set by the `[orgSlug]` layout once the slug has been resolved to an org id (frontend 03 §2). */
export function CurrentOrgProvider({ org, children }: { org: CurrentOrg; children: ReactNode }) {
  return <CurrentOrgContext.Provider value={org}>{children}</CurrentOrgContext.Provider>;
}

export function useCurrentOrg(): CurrentOrg {
  const org = useContext(CurrentOrgContext);
  if (!org) throw new Error('useCurrentOrg must be used inside the [orgSlug] layout');
  return org;
}
