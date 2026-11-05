'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Alert,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { EstimatingIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, formatMoney } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useBidBoard } from '../hooks/useBidBoard';
import {
  STATUS_LABELS,
  STATUS_ORDER,
  responseSummary,
  summarise,
  type BidBoardEntry,
  type PackageStatus,
} from '../lib/types';

const STATUS_TONE: Record<PackageStatus, StatusTone> = {
  draft: 'neutral',
  out_to_tender: 'info',
  closed: 'neutral',
  awarded: 'success',
  cancelled: 'neutral',
};

const DUE_PILL: Record<'overdue' | 'closing_soon', { tone: StatusTone; label: string }> = {
  overdue: { tone: 'danger', label: 'Overdue' },
  closing_soon: { tone: 'warning', label: 'Closing soon' },
};

// The board spans projects with their own zones, so due times show in the viewer's zone.
const viewerZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Every tender package across the company's projects, with how invitees have answered and the lowest price. */
export function BidBoardScreen() {
  const org = useCurrentOrg();
  const [status, setStatus] = useState<PackageStatus | ''>('');
  const [trade, setTrade] = useState('');
  const board = useBidBoard({
    ...(status ? { status } : {}),
    ...(trade ? { trade } : {}),
  });
  const rows = useMemo(() => board.data?.data ?? [], [board.data]);
  const summary = useMemo(() => summarise(rows), [rows]);
  const trades = useMemo(
    () => [...new Set(rows.map((r) => r.trade))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const columns: DataTableColumn<BidBoardEntry>[] = [
    {
      id: 'package',
      header: 'Package',
      rowHeader: true,
      sortValue: (r) => r.numberLabel,
      cell: (r) => (
        <Link className="link" href={webRoutes.tenderPackage(org.orgSlug, r.projectId, r.id)}>
          <span className="u-mono">{r.numberLabel}</span> {r.name}
        </Link>
      ),
    },
    {
      id: 'project',
      header: 'Project',
      sortValue: (r) => r.projectName,
      cell: (r) => r.projectName,
    },
    { id: 'trade', header: 'Trade', sortValue: (r) => r.trade, cell: (r) => r.trade },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => STATUS_ORDER.indexOf(r.status),
      cell: (r) => <StatusPill tone={STATUS_TONE[r.status]}>{STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (r) => r.dueAt ?? '',
      cell: (r) => {
        const pill = r.dueState && r.dueState !== 'open' ? DUE_PILL[r.dueState] : null;
        return (
          <>
            {r.dueAt ? formatInstant(r.dueAt, viewerZone()) : '—'}
            {pill ? (
              <>
                {' '}
                <StatusPill tone={pill.tone}>{pill.label}</StatusPill>
              </>
            ) : null}
          </>
        );
      },
    },
    {
      id: 'responses',
      header: 'Invitees',
      sortValue: (r) => r.invites.submitted,
      cell: (r) => responseSummary(r.invites),
    },
    {
      id: 'review',
      header: 'To review',
      align: 'end',
      sortValue: (r) => r.quotesToReview,
      cell: (r) => r.quotesToReview || '—',
    },
    {
      id: 'lowest',
      header: 'Lowest ex GST',
      align: 'end',
      sortValue: (r) => (r.lowestExGst === null ? null : Number(r.lowestExGst)),
      cell: (r) =>
        r.lowestExGst === null ? '—' : formatMoney({ amount: r.lowestExGst, currency: 'AUD' }),
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Estimating"
        title="Bid board"
        description="Every tender package across your projects: who has answered, what is waiting for you to review and the lowest levelled price."
      />
      <ErrorAlert error={board.error} title="We couldn't load the bid board" />
      {board.data ? (
        <p className="u-muted" aria-live="polite">
          {summary.overdue} overdue · {summary.closingSoon} closing soon · {summary.outToTender} out
          to tender · {summary.toReview} {summary.toReview === 1 ? 'quote' : 'quotes'} to review ·{' '}
          {summary.awarded} awarded
        </p>
      ) : null}
      {board.data?.truncated ? (
        <Alert tone="info" title="Showing the first 500 packages">
          Filter by status or trade to narrow the board.
        </Alert>
      ) : null}
      <div className="form-row">
        <Select
          label="Status"
          value={status}
          placeholder="All statuses"
          options={STATUS_ORDER.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(e) => setStatus(e.target.value as PackageStatus | '')}
        />
        <Select
          label="Trade"
          value={trade}
          placeholder="All trades"
          options={trades.map((t) => ({ value: t, label: t }))}
          onChange={(e) => setTrade(e.target.value)}
        />
      </div>
      {board.isPending ? (
        <SkeletonRows label="Loading the bid board…" />
      ) : (
        <DataTable
          caption="Tender packages across projects"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'due', direction: 'asc' }}
          empty={
            <EmptyState
              icon={EstimatingIcon}
              title="No tender packages yet"
              description="Packages you create on a project's Estimating tool appear here."
            />
          }
        />
      )}
    </div>
  );
}
