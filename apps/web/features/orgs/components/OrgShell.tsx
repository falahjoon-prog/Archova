'use client';

import { notFound } from 'next/navigation';
import type { ComponentProps, ReactNode } from 'react';
import { webRoutes } from '@archova/routes';
import {
  AssistantPanel,
  AssistantScopeProvider,
  useAssistantPanelState,
} from '@/features/assistant';
import { SignOutButton } from '@/features/auth';
import { BrandingStyle, useBranding, useLogoUrl } from '@/features/branding';
import { InboxLink } from '@/features/notifications';
import { SearchLink } from '@/features/search';
import { SupportBanner } from '@/features/support-access';
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
        user: { id: me.data.user.id, name: me.data.user.name },
      }}
    >
      <AssistantScopeProvider>
        <OrgAppShell
          orgName={membership.orgName}
          nav={[
            { href: webRoutes.projects(orgSlug), label: 'Projects' },
            { href: webRoutes.bookmarks(orgSlug), label: 'Bookmarks' },
            ...(membership.kind === 'member'
              ? [
                  {
                    label: 'Portfolio',
                    items: [
                      { href: webRoutes.portfolio(orgSlug), label: 'Portfolio' },
                      { href: webRoutes.reports(orgSlug), label: 'Reports' },
                      ...(membership.role === 'owner' || membership.role === 'admin'
                        ? [{ href: webRoutes.auditLog(orgSlug), label: 'Audit log' }]
                        : []),
                    ],
                  },
                  {
                    label: 'Operations',
                    items: [{ href: webRoutes.plant(orgSlug), label: 'Plant and equipment' }],
                  },
                  {
                    label: 'Tendering',
                    items: [
                      { href: webRoutes.readiness(orgSlug), label: 'Tender readiness' },
                      { href: webRoutes.bidBoard(orgSlug), label: 'Bid board' },
                      { href: webRoutes.prequalification(orgSlug), label: 'Prequalification' },
                    ],
                  },
                ]
              : []),
            {
              label: 'Compliance',
              items: [
                { href: webRoutes.wallet(orgSlug), label: 'Compliance wallet' },
                { href: webRoutes.subcontractorWallets(orgSlug), label: 'Subcontractor wallets' },
              ],
            },
            // Consent for Archova support is an owner/admin decision (platform.support_access.manage).
            {
              label: 'Connections',
              items: [
                { href: webRoutes.apiAccess(orgSlug), label: 'API access' },
                ...(membership.role === 'owner' || membership.role === 'admin'
                  ? [
                      { href: webRoutes.integrations(orgSlug), label: 'Integrations' },
                      { href: webRoutes.apps(orgSlug), label: 'Apps' },
                      { href: webRoutes.accounting(orgSlug), label: 'Accounting' },
                      { href: webRoutes.folders(orgSlug), label: 'SharePoint and Drive' },
                    ]
                  : []),
              ],
            },
            ...(membership.role === 'owner' || membership.role === 'admin'
              ? [
                  {
                    label: 'Settings',
                    items: [
                      { href: webRoutes.contractPlaybook(orgSlug), label: 'Contract playbook' },
                      { href: webRoutes.novaSettings(orgSlug), label: 'Nova settings' },
                      { href: webRoutes.branding(orgSlug), label: 'Branding' },
                      { href: webRoutes.plan(orgSlug), label: 'Plan and limits' },
                      {
                        href: webRoutes.permissionTemplates(orgSlug),
                        label: 'Permission templates',
                      },
                      { href: webRoutes.formTemplates(orgSlug), label: 'Form templates' },
                      { href: webRoutes.supportAccess(orgSlug), label: 'Support access' },
                      { href: webRoutes.dataExport(orgSlug), label: 'Export your data' },
                    ],
                  },
                ]
              : []),
          ]}
          actions={
            <>
              <SearchLink />
              <InboxLink />
              <span className="app-shell__user">{me.data.user.name}</span>
              <SignOutButton />
            </>
          }
        >
          <BrandingStyle />
          <SupportBanner />
          {children}
        </OrgAppShell>
      </AssistantScopeProvider>
    </CurrentOrgProvider>
  );
}

/** The app shell wired to the Ask Nova panel state, which lives in the assistant provider above it. */
function OrgAppShell(props: Omit<ComponentProps<typeof AppShell>, 'assistant' | 'orgLogoUrl'>) {
  const panel = useAssistantPanelState();
  const branding = useBranding();
  const logo = useLogoUrl(branding.data?.logoFileId);
  return (
    <AppShell
      {...props}
      orgLogoUrl={logo.data ?? null}
      assistant={{
        label: 'Ask Nova',
        panel: <AssistantPanel />,
        open: panel.open,
        onOpenChange: panel.setOpen,
      }}
    />
  );
}
