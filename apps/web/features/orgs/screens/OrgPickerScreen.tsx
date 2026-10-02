'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import { buttonClassName, Card, PageHeader } from '@archova/ui';
import { SignOutButton } from '@/features/auth';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { Loading } from '@/shared/layout/Loading';
import { useMe } from '../hooks/useMe';
import { roleLabel } from '../lib/labels';

export function OrgPickerScreen() {
  const me = useMe();
  return (
    <>
      <PageHeader
        title="Your organisations"
        description={
          me.data ? `Signed in as ${me.data.user.email}` : 'Choose an organisation to open.'
        }
      />
      <Card
        title="Organisations"
        actions={
          <Link className={buttonClassName('secondary')} href={webRoutes.newOrg()}>
            New organisation
          </Link>
        }
      >
        {me.isPending ? <Loading label="Loading your organisations…" /> : null}
        <ErrorAlert error={me.error} title="We couldn't load your organisations" />
        {me.data && me.data.memberships.length === 0 ? (
          <p className="u-muted">
            You&apos;re not in any organisations yet. Create one, or ask a colleague to add you to
            theirs.
          </p>
        ) : null}
        {me.data && me.data.memberships.length > 0 ? (
          <ul className="link-list">
            {me.data.memberships.map((m) => (
              <li key={m.orgId}>
                <Link className="link-list__item ac-focusable" href={webRoutes.projects(m.orgSlug)}>
                  <span className="link-list__title">{m.orgName}</span>
                  <span className="link-list__meta">{roleLabel(m.role, m.kind)}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>
      <div className="u-center">
        <SignOutButton />
      </div>
    </>
  );
}
