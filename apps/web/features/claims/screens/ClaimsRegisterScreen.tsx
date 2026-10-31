'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DeadlineChip } from '../components/DeadlineChip';
import type { PaymentClaim, PaymentClaimStatus } from '../data/api';
import { useClaimsRegister, useContracts } from '../hooks/useClaims';
import { STATUS_LABELS } from '../lib/deadline';
import { aud } from '../lib/money';

const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

/** Every payment claim on the project, soonest payment schedule deadline first, so nothing slips (CLM-US6). */
export function ClaimsRegisterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'payment-claims', id: 'register' },
  });
  const [status, setStatus] = useState<PaymentClaimStatus | ''>('');
  const q = useClaimsRegister(project.projectId, status || undefined);
  const contracts = useContracts(project.projectId);
  const today = todayIn(project.timezone);
  const title = (id: string) => contracts.data?.find((c) => c.id === id)?.title ?? 'Contract';

  const columns: DataTableColumn<PaymentClaim>[] = [
    {
      id: 'claim',
      header: 'Claim',
      rowHeader: true,
      sortValue: (x) => x.number,
      cell: (x) => (
        <Link className="link" href={webRoutes.paymentClaim(org.orgSlug, project.projectId, x.id)}>
          {title(x.contractId)}, claim {x.number}
        </Link>
      ),
    },
    {
      id: 'received',
      header: 'Received',
      sortValue: (x) => x.servedOn ?? '',
      cell: (x) => (x.servedOn ? formatLocalDate(x.servedOn) : '—'),
    },
    {
      id: 'total',
      header: 'Claimed (inc GST)',
      align: 'end',
      sortValue: (x) => Number(x.claimedTotal),
      cell: (x) => <span className="u-mono">{aud(x.claimedTotal)}</span>,
    },
    {
      id: 'due',
      header: 'Schedule due',
      sortValue: (x) => x.scheduleDueOn ?? '9999-12-31',
      cell: (x) => (x.scheduleDueOn ? formatLocalDate(x.scheduleDueOn) : '—'),
    },
    { id: 'deadline', header: 'Deadline', cell: (x) => <DeadlineChip claim={x} today={today} /> },
    {
      id: 'pay',
      header: 'Payment due',
      sortValue: (x) => x.paymentDueOn ?? '9999-12-31',
      cell: (x) => (x.paymentDueOn ? formatLocalDate(x.paymentDueOn) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (x) => x.status,
      cell: (x) =>
        x.isValid ? (
          <StatusPill tone="neutral">{STATUS_LABELS[x.status]}</StatusPill>
        ) : (
          <StatusPill tone="warning">Not a valid claim</StatusPill>
        ),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Payment claims"
        description="Payment claims and the day each payment schedule is due. The dates come from the Security of Payment rules for the contract's state."
      />
      <FilterBar label="Claim filters">
        <Select
          label="Status"
          placeholder="All claims"
          options={STATUS_OPTIONS}
          value={status}
          onChange={(e) => setStatus(e.target.value as PaymentClaimStatus | '')}
        />
      </FilterBar>
      <ErrorAlert error={q.error} title="We couldn't load the claims" />
      {q.isPending ? (
        <SkeletonRows label="Loading payment claims…" />
      ) : q.data ? (
        <DataTable
          caption="Payment claims"
          columns={columns}
          rows={q.data}
          getRowId={(x) => x.id}
          defaultSort={{ columnId: 'due', direction: 'asc' }}
          empty={
            <EmptyState
              title="No payment claims"
              description="Claims you record against a contract appear here with their deadlines."
            />
          }
        />
      ) : null}
    </div>
  );
}
