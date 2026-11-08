'use client';

import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Commitment } from '../data/api';
import { useCommitments, useCommitmentSummary } from '../hooks/useCommitments';
import { aud, percentOf, sumAmounts } from '../lib/money';

export const STATUS: Record<
  Commitment['status'],
  { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' }
> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Awaiting approval', tone: 'info' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  void: { label: 'Void', tone: 'neutral' },
};
const KIND: Record<Commitment['kind'], string> = {
  subcontract: 'Subcontract',
  purchase_order: 'Purchase order',
};

/** Subcontracts and purchase orders, with the totals across them at the top. */
export function CommitmentsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'commitments', id: 'commitments' },
  });
  const q = useCommitments(project.projectId);
  const sum = useCommitmentSummary(project.projectId);
  const t = sum.data;
  const revised = t
    ? sumAmounts(t.approvedCommitments.amount, t.approvedChangeOrders.amount)
    : '0.00';
  const pending = t
    ? sumAmounts(t.pendingCommitments.amount, t.pendingChangeOrders.amount)
    : '0.00';

  const columns: DataTableColumn<Commitment>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (c) => c.number,
      cell: (c) => `C-${String(c.number).padStart(4, '0')}`,
    },
    {
      id: 'title',
      header: 'Title',
      sortValue: (c) => c.title,
      cell: (c) => (
        <Link className="link" href={webRoutes.commitment(org.orgSlug, project.projectId, c.id)}>
          {c.title}
        </Link>
      ),
    },
    { id: 'kind', header: 'Type', cell: (c) => KIND[c.kind] },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => <StatusPill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusPill>,
    },
    {
      id: 'total',
      header: 'Original (ex GST)',
      align: 'end',
      sortValue: (c) => Number(c.total),
      cell: (c) => <span className="u-mono u-nowrap">{aud(c.total)}</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Commitments"
        description="Subcontracts and purchase orders placed against the budget. Only approved commitments count as committed cost."
      />
      <ErrorAlert error={q.error ?? sum.error} title="We couldn't load the commitments" />
      <StatGrid
        items={[
          {
            label: 'Original commitments',
            value: aud(t?.approvedCommitments.amount ?? '0.00'),
            hint: `${t?.approvedCommitments.count ?? 0} approved`,
          },
          {
            label: 'Approved change orders',
            value: aud(t?.approvedChangeOrders.amount ?? '0.00'),
            hint: `${t?.approvedChangeOrders.count ?? 0} approved`,
          },
          { label: 'Revised committed', value: aud(revised) },
          {
            label: 'Pending approval',
            value: aud(pending),
            tone: Number(pending) > 0 ? 'warning' : 'neutral',
            hint: `${(t?.pendingCommitments.count ?? 0) + (t?.pendingChangeOrders.count ?? 0)} waiting`,
          },
          {
            label: 'Drafts',
            value: aud(
              sumAmounts(t?.draftCommitments.amount ?? '0', t?.draftChangeOrders.amount ?? '0'),
            ),
            hint: `${(t?.draftCommitments.count ?? 0) + (t?.draftChangeOrders.count ?? 0)} not submitted`,
          },
          {
            label: 'Payments made',
            value: aud(t?.payments.amount ?? '0.00'),
            hint: `${t?.payments.count ?? 0} payments`,
          },
          { label: '% paid', value: `${percentOf(t?.payments.amount ?? '0', revised)}%` },
        ]}
      />
      <DataTable
        caption="Commitments"
        columns={columns}
        rows={q.data ?? []}
        getRowId={(c) => c.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No commitments yet"
            description="Subcontracts and purchase orders raised for this project appear here."
          />
        }
      />
    </div>
  );
}
