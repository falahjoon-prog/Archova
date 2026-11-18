'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useContracts } from '@/features/claims';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatMoney } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { CommitmentInvoice } from '../data/api';
import {
  useCommitment,
  useCommitmentInvoices,
  useLinkCommitmentContract,
} from '../hooks/useCommitments';
import { invoicesToCsv } from '../lib/invoicesCsv';

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });
const pct = (v: string) => `${v}%`;
const date = (iso: string | null) => (iso ? iso : '—');

const CLAIM_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }
> = {
  submitted: { label: 'Submitted', tone: 'info' },
  scheduled: { label: 'Scheduled', tone: 'info' },
  paid: { label: 'Paid', tone: 'success' },
  disputed: { label: 'Disputed', tone: 'danger' },
  adjudication: { label: 'Adjudication', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** One subcontract or purchase order, with the invoices (payment claims) made against it. */
export function CommitmentDetailScreen({ commitmentId }: { commitmentId: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const [tab, setTab] = useState('invoices');
  const q = useCommitment(project.projectId, commitmentId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'commitment', id: commitmentId },
  });

  if (q.isLoading) return <SkeletonRows rows={4} />;
  if (q.error || !q.data)
    return <ErrorAlert error={q.error} title="We couldn't load this commitment" />;
  const { commitment: c, lines } = q.data;
  const isSub = c.kind === 'subcontract';

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow={
          <Link className="link" href={webRoutes.commitments(org.orgSlug, project.projectId)}>
            Commitments
          </Link>
        }
        title={`C-${String(c.number).padStart(4, '0')} ${c.title}`}
        description={isSub ? 'Subcontract' : 'Purchase order'}
      />
      <Tabs
        label="Commitment sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { id: 'invoices', label: 'Invoices' },
          { id: 'lines', label: 'Lines', count: lines.length },
        ]}
      >
        {tab === 'invoices' ? (
          isSub ? (
            <InvoicesTab commitmentId={commitmentId} linkedContractId={c.contractId} />
          ) : (
            <EmptyState
              title="Invoices aren't tracked for purchase orders yet"
              description="Payment claims are made on subcontracts."
            />
          )
        ) : (
          <DataTable
            caption="Commitment lines"
            columns={[
              { id: 'description', header: 'Description', cell: (l) => l.description },
              {
                id: 'amount',
                header: 'Amount (ex GST)',
                align: 'end',
                cell: (l) => <span className="u-mono u-nowrap">{aud(l.amount)}</span>,
              },
            ]}
            rows={lines}
            getRowId={(l) => `${l.budgetLineId}-${l.description}`}
          />
        )}
      </Tabs>
    </div>
  );
}

function InvoicesTab({
  commitmentId,
  linkedContractId,
}: {
  commitmentId: string;
  linkedContractId: string | null;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useCommitmentInvoices(project.projectId, commitmentId);
  const contracts = useContracts(project.projectId);
  const link = useLinkCommitmentContract(project.projectId, commitmentId);
  const [pick, setPick] = useState('');

  if (q.isLoading) return <SkeletonRows rows={4} />;
  if (q.error || !q.data)
    return <ErrorAlert error={q.error} title="We couldn't load the invoices" />;

  if (!q.data.linked || !q.data.summary) {
    const options = (contracts.data ?? [])
      .filter((k) => k.kind === 'subcontract')
      .map((k) => ({ value: k.id, label: `${k.title} (#${k.number})` }));
    return (
      <div className="stack">
        <Alert tone="info" title="No contract linked">
          Invoices are the payment claims made on this subcontract&apos;s contract. Link the
          contract to see them here.
        </Alert>
        <ErrorAlert error={link.error} title="We couldn't link that contract" />
        <Select
          label="Contract"
          placeholder="Choose a subcontract"
          options={options}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        />
        <div>
          <Button disabled={!pick || link.isPending} onClick={() => link.mutate(pick)}>
            Link contract
          </Button>
        </div>
      </div>
    );
  }

  const s = q.data.summary;
  const columns: DataTableColumn<CommitmentInvoice>[] = [
    {
      id: 'number',
      header: 'Invoice #',
      rowHeader: true,
      sortValue: (r) => r.number,
      cell: (r) => (
        <Link
          className="link"
          href={webRoutes.paymentClaim(org.orgSlug, project.projectId, r.claimId)}
        >
          {r.number}
        </Link>
      ),
    },
    {
      id: 'period',
      header: 'Billing period',
      cell: (r) => (
        <span className="u-nowrap">
          {date(r.periodStart)} – {r.periodEnd}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => {
        const st = CLAIM_STATUS[r.status] ?? { label: r.status, tone: 'neutral' as const };
        return <StatusPill tone={st.tone}>{st.label}</StatusPill>;
      },
    },
    ...(
      [
        ['completedToDate', 'Completed to date'],
        ['retainage', 'Retainage'],
        ['earnedLessRetainage', 'Earned less retainage'],
        ['paymentDue', 'Payment due'],
        ['balanceToFinish', 'Balance to finish'],
      ] as const
    ).map(([id, header]) => ({
      id,
      header,
      align: 'end' as const,
      sortValue: (r: CommitmentInvoice) => Number(r[id]),
      cell: (r: CommitmentInvoice) => <span className="u-mono u-nowrap">{aud(r[id])}</span>,
    })),
    {
      id: 'percentComplete',
      header: '% complete',
      align: 'end',
      sortValue: (r) => Number(r.percentComplete),
      cell: (r) => <span className="u-mono u-nowrap">{pct(r.percentComplete)}</span>,
    },
  ];

  return (
    <div className="stack">
      <StatGrid
        items={[
          { label: 'Original contract sum', value: aud(s.originalSum) },
          { label: 'Approved variations', value: aud(s.netChange) },
          { label: 'Revised contract sum', value: aud(s.revisedSum) },
          { label: 'Invoiced to date', value: aud(s.invoiced) },
          { label: 'Paid', value: aud(s.paid), hint: pct(s.percentPaid) + ' of payable' },
          { label: 'Still to pay', value: aud(s.remaining) },
        ]}
      />
      <div className="row">
        <Button
          variant="secondary"
          disabled={s.rows.length === 0}
          onClick={() => downloadCsv('commitment-invoices.csv', invoicesToCsv(s.rows))}
        >
          Export CSV
        </Button>
        {linkedContractId ? (
          <Link
            className="link"
            href={webRoutes.contract(org.orgSlug, project.projectId, linkedContractId)}
          >
            Open contract
          </Link>
        ) : null}
      </div>
      <DataTable
        caption="Invoices"
        columns={columns}
        rows={s.rows}
        getRowId={(r) => r.claimId}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No invoices yet"
            description="Payment claims recorded on the linked contract appear here."
          />
        }
      />
    </div>
  );
}
