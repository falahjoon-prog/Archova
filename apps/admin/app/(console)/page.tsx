'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Card, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { api } from '@/shared/api';
import { can, useStaff } from '@/shared/staff';
import { STATUS_LABEL, formatDateTime, statusTone } from '@/shared/format';

export default function OverviewPage() {
  const staff = useStaff();
  const pending = useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => api.requests({ status: 'pending' }),
    enabled: can(staff, 'backoffice.requests.read'),
  });
  const books = useQuery({
    queryKey: ['price-books'],
    queryFn: api.priceBooks,
    enabled: can(staff, 'backoffice.pricing.read'),
  });
  const orgs = useQuery({
    queryKey: ['orgs', '', 'count'],
    queryFn: () => api.orgs({ limit: 100 }),
    enabled: can(staff, 'backoffice.customers.read'),
  });
  const recent = useQuery({
    queryKey: ['requests', 'recent'],
    queryFn: () => api.requests({ limit: 8 }),
    enabled: can(staff, 'backoffice.requests.read'),
  });

  const live = books.data?.items.find((b) => b.status === 'published');
  const open = books.data?.items.find((b) =>
    ['draft', 'pending_approval', 'scheduled'].includes(b.status),
  );

  return (
    <>
      <PageHeader
        title={`Hello, ${staff.name.split(' ')[0]}`}
        description="What needs you, and what is live."
      />
      <div className="grid-3">
        <Card title="Waiting for approval">
          <div className="stat">
            <span className="stat__value">{pending.data ? pending.data.items.length : '–'}</span>
            <Link className="link" href="/approvals">
              Open approvals
            </Link>
          </div>
        </Card>
        <Card title="Live price book">
          <div className="stat">
            <span className="stat__value">{live?.version ?? '–'}</span>
            <span className="stat__label">
              {open
                ? `${open.version} is ${STATUS_LABEL[open.status]!.toLowerCase()}`
                : 'No change in progress'}
            </span>
            <Link className="link" href="/pricing">
              Open price book
            </Link>
          </div>
        </Card>
        <Card title="Customers">
          <div className="stat">
            <span className="stat__value">
              {orgs.data ? `${orgs.data.items.length}${orgs.data.nextCursor ? '+' : ''}` : '–'}
            </span>
            <Link className="link" href="/customers">
              Open customers
            </Link>
          </div>
        </Card>
      </div>
      <Card title="Recent changes">
        {recent.isPending ? (
          <SkeletonRows rows={3} />
        ) : recent.data?.items.length ? (
          <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {recent.data.items.map((r) => (
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
            Nothing yet. Price and plan changes appear here once someone proposes one.
          </p>
        )}
      </Card>
    </>
  );
}
