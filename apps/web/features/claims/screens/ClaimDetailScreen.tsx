'use client';

import Link from 'next/link';
import {
  Alert,
  Card,
  DataTable,
  DescriptionList,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { DeadlineChip } from '../components/DeadlineChip';
import { IssueScheduleForm } from '../components/IssueScheduleForm';
import { PaymentsCard } from '../components/PaymentsCard';
import { StatementCard } from '../components/StatementCard';
import type { PaymentClaimDetail } from '../data/api';
import { useContract, useVariations, usePaymentClaim } from '../hooks/useClaims';
import { STATUS_LABELS } from '../lib/deadline';
import { aud } from '../lib/money';

type Line = PaymentClaimDetail['lines'][number];

/** One payment claim: its amounts and stored dates, the lines claimed, and the payment schedule or the form to issue it. */
export function ClaimDetailScreen({ claimId }: { claimId: string }) {
  const project = useCurrentProject();
  const q = usePaymentClaim(project.projectId, claimId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'payment-claim', id: claimId },
  });
  if (q.isPending) return <SkeletonRows label="Loading the claim…" />;
  if (q.isError) return <ErrorAlert error={q.error} title="We couldn't open this claim" />;
  return <Detail d={q.data} />;
}

function Detail({ d }: { d: PaymentClaimDetail }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  const contract = useContract(project.projectId, d.claim.contractId);
  const variations = useVariations(project.projectId, d.claim.contractId);
  const c = d.claim;
  const today = todayIn(project.timezone);
  const canAssess =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'admin');
  const canRecord =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.payment_claims, 'standard');
  const item = (id: string) => contract.data?.sov.find((s) => s.id === id);

  const lineColumns: DataTableColumn<Line>[] = [
    {
      id: 'item',
      header: 'Item',
      rowHeader: true,
      cell: (l) => {
        if (l.variationId) {
          const v = variations.data?.data.find((x) => x.id === l.variationId);
          return v ? `Variation ${v.number} ${v.title}` : 'Variation';
        }
        const it = l.sovItemId ? item(l.sovItemId) : undefined;
        return `${it?.code ?? ''} ${it?.description ?? ''}`.trim() || 'Line';
      },
    },
    {
      id: 'previous',
      header: 'Previously claimed',
      align: 'end',
      cell: (l) => <span className="u-mono">{aud(l.previous)}</span>,
    },
    {
      id: 'this',
      header: 'This claim',
      align: 'end',
      cell: (l) => <span className="u-mono">{aud(l.thisClaim)}</span>,
    },
    {
      id: 'todate',
      header: 'To date',
      align: 'end',
      cell: (l) => <span className="u-mono">{aud(l.toDate)}</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <p className="u-m-0">
        <Link className="link" href={webRoutes.paymentClaims(org.orgSlug, project.projectId)}>
          Payment claims
        </Link>
      </p>
      <h1 className="u-m-0">
        {contract.data?.contract.title ?? 'Contract'}, payment claim {c.number}
      </h1>
      <div className="row-actions">
        <StatusPill tone="neutral">{STATUS_LABELS[c.status]}</StatusPill>
        <DeadlineChip claim={c} today={today} />
      </div>
      {!c.isValid ? (
        <Alert tone="warning" title="Not a valid payment claim">
          This claim doesn&apos;t say it is made under the Act, which {c.ruleState ?? 'the state'}{' '}
          requires. No deadlines have started. Get advice before treating it as valid or ignoring
          it.
        </Alert>
      ) : null}
      {c.isValid && !c.rulesReviewed ? (
        <Alert tone="info" title="Rules not yet legally reviewed">
          These dates use the {c.ruleState} rules, which a construction lawyer hasn&apos;t signed
          off yet. Check them before relying on them.
        </Alert>
      ) : null}
      {c.paymentReadDown ? (
        <Alert tone="info">
          The contract allows longer to pay than the Act does, so the Act&apos;s period is used.
        </Alert>
      ) : null}
      <div className="two-col">
        <Card title="Dates">
          <DescriptionList
            items={[
              { label: 'Claim period ends', value: formatLocalDate(c.periodEnd) },
              { label: 'Received', value: formatInstant(c.receivedAt, project.timezone) },
              {
                label: 'Counted as served on',
                value: c.servedOn ? formatLocalDate(c.servedOn) : '—',
              },
              {
                label: 'Payment schedule due',
                value: c.scheduleDueOn ? formatLocalDate(c.scheduleDueOn) : '—',
              },
              {
                label: 'Payment due',
                value: c.paymentDueOn ? formatLocalDate(c.paymentDueOn) : '—',
              },
            ]}
          />
        </Card>
        <Card title="Amounts">
          <DescriptionList
            items={[
              { label: 'Claimed to date (ex GST)', value: aud(c.claimedGross), mono: true },
              { label: 'Less previously claimed', value: aud(c.lessPrevious), mono: true },
              { label: 'Retention held back', value: aud(c.retention), mono: true },
              { label: 'Net this claim (ex GST)', value: aud(c.claimedNet), mono: true },
              { label: 'GST', value: aud(c.gst), mono: true },
              { label: 'Total (inc GST)', value: aud(c.claimedTotal), mono: true },
            ]}
          />
        </Card>
      </div>
      <DataTable
        caption="Lines claimed"
        columns={lineColumns}
        rows={d.lines}
        getRowId={(l) => (l.sovItemId ?? l.variationId)!}
      />
      <StatementCard detail={d} canRecord={canRecord} />
      {d.schedule ? (
        <Card title="Payment schedule">
          <DescriptionList
            items={[
              { label: 'Scheduled (ex GST)', value: aud(d.schedule.scheduledAmount), mono: true },
              { label: 'Withheld', value: aud(d.schedule.withheldAmount), mono: true },
              { label: 'Issued', value: formatInstant(d.schedule.issuedAt, project.timezone) },
              {
                label: 'Issued in time',
                value: d.schedule.issuedWithinTime ? (
                  <StatusPill tone="success">Within time</StatusPill>
                ) : (
                  <StatusPill tone="danger">After the due date</StatusPill>
                ),
              },
              ...(d.schedule.overallReason
                ? [{ label: 'Reasons', value: d.schedule.overallReason }]
                : []),
            ]}
          />
        </Card>
      ) : c.isValid && c.status === 'submitted' && canAssess ? (
        <Card title="Issue the payment schedule">
          <IssueScheduleForm detail={d} />
        </Card>
      ) : null}
      <PaymentsCard detail={d} canRecord={canAssess} />
    </div>
  );
}
