'use client';

import { useQuery } from '@tanstack/react-query';
import { Alert, DataTable, PageHeader, SkeletonRows, StatusPill } from '@archova/ui';
import { api } from '@/shared/api';
import { formatDate } from '@/shared/format';

type Row = {
  id: string;
  email: string;
  name: string;
  status: string;
  roles: string[];
  createdAt: string;
};

export default function StaffPage() {
  const staff = useQuery({ queryKey: ['staff'], queryFn: api.staff });
  return (
    <>
      <PageHeader
        title="Staff"
        description="Who can use this console, and in which roles. Accounts are created by an Owner from the command line for now."
      />
      {staff.isError ? (
        <Alert tone="danger" title="Could not load staff">
          {staff.error.message}
        </Alert>
      ) : staff.isPending ? (
        <SkeletonRows />
      ) : (
        <DataTable<Row>
          caption="Staff"
          rows={staff.data.items}
          getRowId={(r) => r.id}
          columns={[
            { id: 'name', header: 'Name', rowHeader: true, cell: (r) => r.name },
            {
              id: 'email',
              header: 'Email',
              cell: (r) => <span className="table-cell-wrap">{r.email}</span>,
            },
            {
              id: 'roles',
              header: 'Roles',
              cell: (r) => r.roles.map((x) => x.replace(/_/g, ' ')).join(', ') || '—',
            },
            {
              id: 'status',
              header: 'Status',
              cell: (r) => (
                <StatusPill tone={r.status === 'active' ? 'success' : 'neutral'}>
                  {r.status === 'active' ? 'Active' : 'Disabled'}
                </StatusPill>
              ),
            },
            { id: 'created', header: 'Added', cell: (r) => formatDate(r.createdAt) },
          ]}
        />
      )}
    </>
  );
}
