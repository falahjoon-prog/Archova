'use client';

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { webRoutes } from '@archova/routes';
import { SignOutButton } from '@/features/auth';
import { AppShell, CentredShell } from '@/shared/layout/AppShell';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { CurrentOrgProvider } from '@/shared/providers/CurrentOrgProvider';
import { useMe } from '../hooks/useMe';

/**
 * The `[orgSlug]` shell (frontend 03 §2-3): resolves slug → org id from the caller's memberships and 404s for
 * orgs they don't belong to, so slugs can't be probed. The API re-checks membership on every call.
 */
export function OrgShell({ orgSlug, children }: { orgSlug: string; children: ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <CentredShell>
        <Loading label="Opening organisation…" />
      </CentredShell>
    );
  }
  if (me.isError) {
    return (
      <CentredShell>
        <ErrorAlert error={me.error} title="We couldn't open this organisation" />
      </CentredShell>
    );
  }

  const membership = me.data.memberships.find((m) => m.orgSlug === orgSlug);
  if (!membership) notFound();

  return (
    <CurrentOrgProvider
      org={{
        orgId: membership.orgId,
        orgSlug: membership.orgSlug,
        orgName: membership.orgName,
        role: membership.role,
        kind: membership.kind,
      }}
    >
      <AppShell
        orgName={membership.orgName}
        nav={[{ href: webRoutes.projects(orgSlug), label: 'Projects' }]}
        actions={
          <>
            <span className="app-shell__user">{me.data.user.name}</span>
            <SignOutButton />
          </>
        }
      >
        {children}
      </AppShell>
    </CurrentOrgProvider>
  );
}
