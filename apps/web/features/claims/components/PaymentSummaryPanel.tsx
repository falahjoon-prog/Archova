'use client';

import {
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ContractPaymentSummary } from '../data/api';
import { usePaymentSummary } from '../hooks/useClaims';
import { aud } from '../lib/money';
import { TrustPanel } from './TrustPanel';

type Row = ContractPaymentSummary['claims'][number];

/**
 * What a payee needs from one contract in one place: each claim, what was scheduled, paid and is still owing, and
 * where their retention sits. Builder staff see the same figures, with the trust forms.
 */
export function PaymentSummaryPanel({
  contractId,
  canManageTrust,
}: {
  contractId: string;
  canManageTrust: boolean;
}) {
  const project = useCurrentProject();
  const q = usePaymentSummary(project.projectId, contractId);
  if (q.isPending) return <SkeletonRows label="Loading payments…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't load the payments" />;
  const s = q.data;
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'number',
      header: 'Claim',
      rowHeader: true,
      sortValue: (x) => x.number,
      cell: (x) => `Claim ${x.number}`,
    },
    { id: 'period', header: 'Period ends', cell: (x) => formatLocalDate(x.periodEnd) },
    {
      id: 'due',
      header: 'Due (inc GST)',
      align: 'end',
      cell: (x) => (
        <span className="u-mono">{x.amountDue ? aud(x.amountDue) : 'Awaiting schedule'}</span>
      ),
    },
    {
      id: 'paid',
      header: 'Paid',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.paid)}</span>,
    },
    {
      id: 'outstanding',
      header: 'Outstanding',
      align: 'end',
      cell: (x) => <span className="u-mono">{x.outstanding ? aud(x.outstanding) : '—'}</span>,
    },
    {
      id: 'payBy',
      header: 'Pay by',
      cell: (x) => (x.paymentDueOn ? formatLocalDate(x.paymentDueOn) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (x) =>
        x.overdue ? (
          <StatusPill tone="danger">Overdue</StatusPill>
        ) : x.outstanding === '0.00' ? (
          <StatusPill tone="success">Paid</StatusPill>
        ) : (
          <StatusPill tone="neutral">{x.amountDue ? 'Owing' : 'Not scheduled'}</StatusPill>
        ),
    },
  ];
  return (
    <section className="stack-lg" aria-label="Payments">
      <Card title="Payments">
        <DescriptionList
          items={[
            { label: 'Scheduled to pay (inc GST)', value: aud(s.totalDue), mono: true },
            { label: 'Paid so far', value: aud(s.totalPaid), mono: true },
          ]}
        />
      </Card>
      <DataTable
        caption="Payments by claim"
        columns={columns}
        rows={s.claims}
        getRowId={(x) => x.claimId}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No claims yet"
            description="Once a claim is recorded you can follow its schedule and payments here."
          />
        }
      />
      <TrustPanel contractId={contractId} trust={s.trust} canManage={canManageTrust} />
    </section>
  );
}
