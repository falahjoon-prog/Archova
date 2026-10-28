'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Building2 } from '@archova/ui/icons';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  SkeletonRows,
  StatusPill,
  TextField,
} from '@archova/ui';
import type { OrgListItemDto } from '@archova/contracts';
import { api } from '@/shared/api';
import { formatDate, planStateLabel } from '@/shared/format';

export default function CustomersPage() {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);

  const list = useInfiniteQuery({
    queryKey: ['orgs', q],
    queryFn: ({ pageParam }) =>
      api.orgs({ q, ...(pageParam ? { cursor: pageParam } : {}), limit: 25 }),
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Builder companies on Archova, from the tenant directory. Project content is never shown here."
      />
      <FilterBar label="Find a customer">
        <div className="search">
          <TextField
            label="Search by name or web address"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
      </FilterBar>
      {list.isError ? (
        <Alert tone="danger" title="Could not load customers">
          {list.error.message}
        </Alert>
      ) : list.isPending ? (
        <SkeletonRows rows={6} />
      ) : (
        <DataTable<OrgListItemDto>
          caption="Customers"
          rows={rows}
          getRowId={(r) => r.orgId}
          empty={
            <EmptyState
              icon={Building2}
              title={q ? 'No customer matches that search' : 'No customers yet'}
              description={
                q
                  ? 'Try part of the company name.'
                  : 'Companies appear here when someone creates an organisation.'
              }
            />
          }
          columns={[
            {
              id: 'name',
              header: 'Company',
              rowHeader: true,
              cell: (r) => (
                <Link className="link table-cell-wrap" href={`/customers/${r.orgId}`}>
                  {r.name}
                </Link>
              ),
            },
            { id: 'plan', header: 'Plan', cell: (r) => r.plan },
            {
              id: 'state',
              header: 'State',
              cell: (r) => (
                <StatusPill
                  tone={
                    r.state === 'active' ? 'success' : r.state === 'trialing' ? 'info' : 'warning'
                  }
                >
                  {planStateLabel(r.state)}
                </StatusPill>
              ),
            },
            { id: 'seats', header: 'Seats', align: 'end', cell: (r) => r.seats ?? '—' },
            { id: 'created', header: 'Created', cell: (r) => formatDate(r.createdAt) },
          ]}
          footer={
            list.hasNextPage ? (
              <tr>
                <td colSpan={5}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void list.fetchNextPage()}
                    loading={list.isFetchingNextPage}
                  >
                    Load more
                  </Button>
                </td>
              </tr>
            ) : undefined
          }
        />
      )}
    </>
  );
}
