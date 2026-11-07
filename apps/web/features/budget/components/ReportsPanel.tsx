'use client';

import { useState } from 'react';
import {
  Button,
  Card,
  DataTable,
  DescriptionList,
  EmptyState,
  SkeletonRows,
  StatusPill,
  ToggleGroup,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Budget, ProjectBudgetAdjustment } from '../data/api';
import { useBudget, useDirectCosts, useProjectAdjustments } from '../hooks/useBudget';
import { aud } from '../lib/money';
import {
  CATEGORIES,
  buyoutRows,
  buyoutTotals,
  modificationsTotal,
  resourceRows,
  toCsv,
  type BuyoutRow,
  type ResourceRow,
} from '../lib/reports';

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const Amount = ({ value }: { value: string }) => (
  <span className="u-mono u-nowrap">{aud(value)}</span>
);
const pct = (p: number | null) => (p === null ? 'n/a' : `${p}%`);

const BUYOUT_TONE = { none: 'neutral', partial: 'info', full: 'success', over: 'danger' } as const;
const BUYOUT_LABEL = {
  none: 'Not started',
  partial: 'Part bought out',
  full: 'Bought out',
  over: 'Over committed',
} as const;

/** One-click reports built from the budget, its revisions, commitments and recorded direct costs. */
export function ReportsPanel() {
  const project = useCurrentProject();
  const [report, setReport] = useState('buyout');
  const budget = useBudget(project.projectId);
  const adjustments = useProjectAdjustments(project.projectId);
  const costs = useDirectCosts(project.projectId);
  const lines = budget.data?.lines ?? [];

  return (
    <div className="stack-lg">
      <ToggleGroup
        label="Report"
        value={report}
        onValueChange={setReport}
        options={[
          { value: 'buyout', label: 'Buyout summary' },
          { value: 'modifications', label: 'Budget modifications' },
          { value: 'resources', label: 'Monitored resources' },
        ]}
      />
      {report === 'buyout' ? (
        <Buyout state={budget} />
      ) : report === 'modifications' ? (
        <Modifications state={adjustments} timezone={project.timezone} />
      ) : (
        <Resources
          lines={lines}
          state={costs}
          budgetError={budget.error}
          budgetPending={budget.isPending}
        />
      )}
    </div>
  );
}

function Header({
  title,
  caption,
  onDownload,
  disabled,
}: {
  title: string;
  caption: string;
  onDownload: () => void;
  disabled: boolean;
}) {
  return (
    <div className="row-actions">
      <div>
        <h2 className="u-m-0">{title}</h2>
        <p className="u-m-0 u-caption">{caption}</p>
      </div>
      <Button variant="secondary" onClick={onDownload} disabled={disabled}>
        Download CSV
      </Button>
    </div>
  );
}

function Buyout({ state }: { state: ReturnType<typeof useBudget> }) {
  if (state.isPending) return <SkeletonRows label="Loading report…" />;
  if (state.error) return <ErrorAlert error={state.error} title="We couldn't load the report" />;
  const rows = buyoutRows(state.data?.lines ?? []);
  const t = buyoutTotals(rows);
  const columns: DataTableColumn<BuyoutRow>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="u-mono u-nowrap">{r.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (r) => r.codeDescription },
    {
      id: 'revised',
      header: 'Revised budget',
      align: 'end',
      sortValue: (r) => Number(r.revised),
      cell: (r) => <Amount value={r.revised} />,
    },
    {
      id: 'committed',
      header: 'Committed',
      align: 'end',
      sortValue: (r) => Number(r.committed),
      cell: (r) => <Amount value={r.committed} />,
    },
    {
      id: 'uncommitted',
      header: 'Not yet committed',
      align: 'end',
      sortValue: (r) => Number(r.uncommitted),
      cell: (r) => <Amount value={r.uncommitted} />,
    },
    {
      id: 'percent',
      header: 'Bought out',
      align: 'end',
      sortValue: (r) => r.percent ?? -1,
      cell: (r) => <span className="u-nowrap">{pct(r.percent)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={BUYOUT_TONE[r.status]}>{BUYOUT_LABEL[r.status]}</StatusPill>,
    },
  ];
  return (
    <div className="stack-lg">
      <Header
        title="Buyout summary"
        caption="Approved commitments against each line's revised budget. Margin lines are left out."
        disabled={rows.length === 0}
        onDownload={() =>
          download(
            'buyout-summary.csv',
            toCsv(
              [
                'Cost code',
                'Description',
                'Revised budget',
                'Committed',
                'Not yet committed',
                'Bought out %',
                'Status',
              ],
              rows.map((r) => [
                r.code,
                r.codeDescription,
                r.revised,
                r.committed,
                r.uncommitted,
                r.percent,
                BUYOUT_LABEL[r.status],
              ]),
            ),
          )
        }
      />
      <Card>
        <DescriptionList
          items={[
            { label: 'Revised budget', value: <Amount value={t.revised} /> },
            { label: 'Committed', value: <Amount value={t.committed} /> },
            { label: 'Not yet committed', value: <Amount value={t.uncommitted} /> },
          ]}
        />
      </Card>
      <DataTable
        caption="Buyout by cost code"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ columnId: 'code', direction: 'asc' }}
        empty={
          <EmptyState
            title="No budget lines"
            description="Add budget lines to see how much has been bought out."
          />
        }
      />
    </div>
  );
}

function Modifications({
  state,
  timezone,
}: {
  state: ReturnType<typeof useProjectAdjustments>;
  timezone: string;
}) {
  if (state.isPending) return <SkeletonRows label="Loading report…" />;
  if (state.error) return <ErrorAlert error={state.error} title="We couldn't load the report" />;
  const rows = state.data ?? [];
  const columns: DataTableColumn<ProjectBudgetAdjustment>[] = [
    {
      id: 'when',
      header: 'Date',
      sortValue: (r) => r.createdAt,
      cell: (r) => <span className="u-nowrap">{formatInstant(r.createdAt, timezone)}</span>,
    },
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="u-mono u-nowrap">{r.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (r) => r.codeDescription },
    {
      id: 'amount',
      header: 'Change',
      align: 'end',
      sortValue: (r) => Number(r.amount),
      cell: (r) => <Amount value={r.amount} />,
    },
    { id: 'reason', header: 'Reason', cell: (r) => r.reason },
  ];
  return (
    <div className="stack-lg">
      <Header
        title="Budget modifications"
        caption="Every change made to the budget after it was locked, newest first."
        disabled={rows.length === 0}
        onDownload={() =>
          download(
            'budget-modifications.csv',
            toCsv(
              ['Date', 'Cost code', 'Description', 'Change', 'Reason'],
              rows.map((r) => [r.createdAt, r.code, r.codeDescription, r.amount, r.reason]),
            ),
          )
        }
      />
      <Card>
        <DescriptionList
          items={[
            { label: 'Modifications', value: String(rows.length) },
            { label: 'Net change', value: <Amount value={modificationsTotal(rows)} /> },
          ]}
        />
      </Card>
      <DataTable
        caption="Budget modifications"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ columnId: 'when', direction: 'desc' }}
        empty={
          <EmptyState
            title="No modifications"
            description="Changes made after the budget is locked appear here."
          />
        }
      />
    </div>
  );
}

function Resources({
  lines,
  state,
  budgetError,
  budgetPending,
}: {
  lines: Budget['lines'];
  state: ReturnType<typeof useDirectCosts>;
  budgetError: unknown;
  budgetPending: boolean;
}) {
  if (state.isPending || budgetPending) return <SkeletonRows label="Loading report…" />;
  if (state.error) return <ErrorAlert error={state.error} title="We couldn't load the report" />;
  if (budgetError) return <ErrorAlert error={budgetError} title="We couldn't load the report" />;
  const rows = resourceRows(lines, state.data?.data ?? []);
  const label = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);
  const columns: DataTableColumn<ResourceRow>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="u-mono u-nowrap">{r.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (r) => r.codeDescription },
    ...CATEGORIES.map((k): DataTableColumn<ResourceRow> => ({
      id: k,
      header: label(k),
      align: 'end',
      sortValue: (r) => Number(r.byCategory[k]),
      cell: (r) => <Amount value={r.byCategory[k]} />,
    })),
    {
      id: 'spent',
      header: 'Spent',
      align: 'end',
      sortValue: (r) => Number(r.spent),
      cell: (r) => <Amount value={r.spent} />,
    },
    {
      id: 'revised',
      header: 'Revised budget',
      align: 'end',
      sortValue: (r) => Number(r.revised),
      cell: (r) => <Amount value={r.revised} />,
    },
    {
      id: 'percent',
      header: 'Used',
      align: 'end',
      sortValue: (r) => r.percent ?? -1,
      cell: (r) =>
        r.over ? (
          <StatusPill tone="danger">{pct(r.percent)}</StatusPill>
        ) : (
          <span className="u-nowrap">{pct(r.percent)}</span>
        ),
    },
  ];
  return (
    <div className="stack-lg">
      <Header
        title="Monitored resources"
        caption="Recorded direct costs by resource type against each line's revised budget. Voided costs are left out."
        disabled={rows.length === 0}
        onDownload={() =>
          download(
            'monitored-resources.csv',
            toCsv(
              [
                'Cost code',
                'Description',
                ...CATEGORIES.map(label),
                'Spent',
                'Revised budget',
                'Used %',
              ],
              rows.map((r) => [
                r.code,
                r.codeDescription,
                ...CATEGORIES.map((k) => r.byCategory[k]),
                r.spent,
                r.revised,
                r.percent,
              ]),
            ),
          )
        }
      />
      <DataTable
        caption="Spend by resource type"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        defaultSort={{ columnId: 'code', direction: 'asc' }}
        empty={
          <EmptyState
            title="No direct costs yet"
            description="Record direct costs against budget lines to see them here."
          />
        }
      />
    </div>
  );
}
