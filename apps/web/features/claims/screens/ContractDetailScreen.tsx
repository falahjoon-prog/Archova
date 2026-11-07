'use client';

import Link from 'next/link';
import {
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { DeadlineChip } from '../components/DeadlineChip';
import { OwnerInvoicesPanel } from '../components/OwnerInvoicesPanel';
import { PrimeContractSummary } from '../components/PrimeContractSummary';
import { PaymentSummaryPanel } from '../components/PaymentSummaryPanel';
import { RecordClaimForm } from '../components/RecordClaimForm';
import { VariationsPanel } from '../components/VariationsPanel';
import type { ContractDetail, PaymentClaim, SovItem } from '../data/api';
import { useClaimsRegister, useContract } from '../hooks/useClaims';
import { KIND_LABELS, STATUS_LABELS } from '../lib/deadline';
import { aud } from '../lib/money';

/** One contract: terms, schedule of values, its claims, and (for staff) a form to record the next claim. */
export function ContractDetailScreen({ contractId }: { contractId: string }) {
  const project = useCurrentProject();
  const q = useContract(project.projectId, contractId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'contract', id: contractId },
  });
  if (q.isPending) return <SkeletonRows label="Loading the contract…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't open this contract" />;
  return <Detail d={q.data} />;
}

function Detail({ d }: { d: ContractDetail }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const register = useClaimsRegister(project.projectId);
  const c = d.contract;
  const canRecord =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'standard');
  const canDecide =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'admin');
  const today = todayIn(project.timezone);
  const claims = (register.data ?? []).filter((x) => x.contractId === c.id);
  const payee = dir.companies.find((x) => x.id === c.payeeCompanyId)?.name ?? '—';

  const sovColumns: DataTableColumn<SovItem>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      cell: (s) => <span className="u-mono">{s.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (s) => s.description },
    {
      id: 'value',
      header: 'Value (ex GST)',
      align: 'end',
      cell: (s) => <span className="u-mono">{aud(s.value)}</span>,
    },
  ];
  const claimColumns: DataTableColumn<PaymentClaim>[] = [
    {
      id: 'number',
      header: 'Claim',
      rowHeader: true,
      sortValue: (x) => x.number,
      cell: (x) => (
        <Link className="link" href={webRoutes.paymentClaim(org.orgSlug, project.projectId, x.id)}>
          Claim {x.number}
        </Link>
      ),
    },
    { id: 'period', header: 'Period ends', cell: (x) => formatLocalDate(x.periodEnd) },
    {
      id: 'total',
      header: 'Claimed (inc GST)',
      align: 'end',
      cell: (x) => <span className="u-mono">{aud(x.claimedTotal)}</span>,
    },
    {
      id: 'due',
      header: 'Schedule due',
      cell: (x) => (x.scheduleDueOn ? formatLocalDate(x.scheduleDueOn) : '—'),
    },
    { id: 'deadline', header: 'Deadline', cell: (x) => <DeadlineChip claim={x} today={today} /> },
    {
      id: 'status',
      header: 'Status',
      cell: (x) => <StatusPill tone="neutral">{STATUS_LABELS[x.status]}</StatusPill>,
    },
  ];

  return (
    <div className="stack-lg">
      <p className="u-m-0">
        <Link className="link" href={webRoutes.contracts(org.orgSlug, project.projectId)}>
          Contracts
        </Link>
      </p>
      <h1 className="u-m-0">{c.title}</h1>
      {c.kind === 'head' ? <PrimeContractSummary contract={c} claims={claims} /> : null}
      <Card title="Terms">
        <DescriptionList
          items={[
            { label: 'Type', value: KIND_LABELS[c.kind] },
            { label: 'Payee', value: payee },
            { label: 'Contract value (ex GST)', value: aud(c.originalValue), mono: true },
            {
              label: 'Retention',
              value: `${c.retentionPct}%${c.retentionCapPct ? `, capped at ${c.retentionCapPct}% of the contract` : ''}`,
            },
            { label: 'Security of Payment state', value: c.sopaState },
            {
              label: 'Days to give a payment schedule',
              value: c.scheduleDays
                ? `${c.scheduleDays} business days`
                : 'Contract silent: the Act applies',
            },
            {
              label: 'Days to pay',
              value: c.paymentDays ? `${c.paymentDays} days` : 'Contract silent: the Act applies',
            },
          ]}
        />
      </Card>
      <DataTable
        caption="Schedule of values"
        columns={sovColumns}
        rows={d.sov}
        getRowId={(s) => s.id}
      />
      <VariationsPanel contractId={c.id} canManage={canRecord} canDecide={canDecide} />
      <ErrorAlert error={register.error} title="We couldn't load the claims" />
      <DataTable
        caption="Payment claims on this contract"
        columns={claimColumns}
        rows={claims}
        getRowId={(x) => x.id}
        defaultSort={{ columnId: 'number', direction: 'desc' }}
        empty={
          <EmptyState
            title="No claims yet"
            description="Claims recorded against this contract appear here with their deadlines."
          />
        }
      />
      {c.kind === 'head' && !perms.data?.isExternal ? (
        <OwnerInvoicesPanel contractId={c.id} canManage={canRecord} />
      ) : null}
      <PaymentSummaryPanel
        contractId={c.id}
        canManageTrust={canDecide && !perms.data?.isExternal}
      />
      {canRecord ? (
        <Card title="Record a payment claim">
          <RecordClaimForm detail={d} />
        </Card>
      ) : null}
    </div>
  );
}
