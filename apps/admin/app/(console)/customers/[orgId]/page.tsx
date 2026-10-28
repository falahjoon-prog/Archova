'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { Alert, Card, DescriptionList, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { ApiError, api } from '@/shared/api';
import {
  STATUS_LABEL,
  formatDate,
  formatDateTime,
  planStateLabel,
  statusTone,
} from '@/shared/format';

export default function CustomerPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = use(params);
  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api.org(orgId) });

  if (org.isPending) return <SkeletonRows rows={5} />;
  if (org.isError)
    return (
      <>
        <PageHeader title="Customer" />
        <Alert
          tone="danger"
          title={
            org.error instanceof ApiError && org.error.status === 404
              ? 'No such customer'
              : 'Could not load this customer'
          }
        >
          {org.error.message}{' '}
          <Link className="link" href="/customers">
            Back to customers
          </Link>
        </Alert>
      </>
    );
  const o = org.data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link className="link" href="/customers">
            Customers
          </Link>
        }
        title={o.name}
        actions={
          <StatusPill tone={o.state === 'active' ? 'success' : 'info'}>
            {planStateLabel(o.state)}
          </StatusPill>
        }
      />
      <Card title="Account">
        <DescriptionList
          items={[
            { label: 'Web address', value: o.slug, mono: true },
            { label: 'Plan', value: o.plan },
            { label: 'Seats', value: o.seats ?? '—' },
            { label: 'Trial ends', value: formatDate(o.trialEndsAt) },
            { label: 'Created', value: formatDate(o.createdAt) },
            { label: 'Organisation id', value: o.orgId, mono: true },
          ]}
        />
      </Card>
      <Card title="Staff actions on this customer">
        {o.history.length ? (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {o.history.map((r) => (
              <li key={r.id} className="row">
                <StatusPill tone={statusTone(r.status)}>{STATUS_LABEL[r.status]}</StatusPill>
                <span>
                  {r.subject}{' '}
                  <span className="muted">
                    · {r.requestedBy.name} · {formatDateTime(r.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No staff action has been taken on this customer. Trial extensions, credits and
            suspensions arrive with the support tools.
          </p>
        )}
      </Card>
    </>
  );
}
