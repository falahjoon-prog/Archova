'use client';

import {
  DataTable,
  EmptyState,
  PageHeader,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatMoney } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Commitment } from '../data/api';
import { useCommitments } from '../hooks/useCommitments';
import { rollupCommitments } from '../lib/rollup';

const STATUS: Record<
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
const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });
const money = (cents: number) => formatMoney({ amount: (cents / 100).toFixed(2), currency: 'AUD' });

/** Subcontracts and purchase orders, with the totals across them at the top. */
export function CommitmentsScreen() {
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'commitments', id: 'commitments' },
  });
  const q = useCommitments(project.projectId);
  const rows = q.data ?? [];
  const roll = rollupCommitments(rows);

  const columns: DataTableColumn<Commitment>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (c) => c.number,
      cell: (c) => `C-${String(c.number).padStart(4, '0')}`,
    },
    { id: 'title', header: 'Title', sortValue: (c) => c.title, cell: (c) => c.title },
    { id: 'kind', header: 'Type', cell: (c) => KIND[c.kind] },
    {
      id: 'status',
      header: 'Status',
      cell: (c) => <StatusPill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</StatusPill>,
    },
    {
      id: 'total',
      header: 'Value (ex GST)',
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
      <ErrorAlert error={q.error} title="We couldn't load the commitments" />
      <StatGrid
        items={[
          {
            label: 'Committed (approved)',
            value: money(roll.committed),
            hint: `${roll.counts.approved} approved`,
          },
          {
            label: 'Awaiting approval',
            value: money(roll.pending),
            tone: roll.pending > 0 ? 'warning' : 'neutral',
            hint: `${roll.counts.submitted} submitted`,
          },
          { label: 'Drafts', value: money(roll.draft), hint: `${roll.counts.draft} not submitted` },
          {
            label: 'Committed if all approved',
            value: money(roll.ifApproved),
          },
        ]}
      />
      <DataTable
        caption="Commitments"
        columns={columns}
        rows={rows}
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
