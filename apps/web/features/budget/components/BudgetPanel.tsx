'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  DescriptionList,
  Dialog,
  EmptyState,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetLine } from '../data/api';
import { useBudget, useBudgetMutations, useCostCodes } from '../hooks/useBudget';
import { aud } from '../lib/money';
import { AdjustDialog } from './AdjustDialog';
import { ImportDialog } from './ImportDialog';
import { LineDialog } from './LineDialog';

/**
 * The project budget. A draft is edited freely; locking freezes the original, and from then on every change is an
 * adjustment with a reason. Lines marked as margin only come back from the server for people with margin access.
 */
export function BudgetPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const q = useBudget(project.projectId);
  const codes = useCostCodes(project.projectId);
  const { createBudget, lock, deleteLine } = useBudgetMutations(project.projectId);
  const [editing, setEditing] = useState<BudgetLine | 'new' | null>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [confirmLock, setConfirmLock] = useState(false);
  const [importing, setImporting] = useState(false);

  const budget = q.data;
  const locked = budget?.status === 'locked';
  const used = new Set((budget?.lines ?? []).map((l) => l.costCodeId));
  const available = (codes.data ?? []).filter((c) => !c.archived && !used.has(c.id));
  const adjustingLine = budget?.lines.find((l) => l.id === adjusting);

  const columns: DataTableColumn<BudgetLine>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (l) => l.code,
      cell: (l) => <span className="u-mono u-nowrap">{l.code}</span>,
    },
    {
      id: 'description',
      header: 'Description',
      sortValue: (l) => l.codeDescription,
      cell: (l) => (
        <>
          <span className="row-actions">
            {l.codeDescription}
            {l.isMargin ? <StatusPill tone="info">Margin</StatusPill> : null}
          </span>
          {l.description ? <p className="u-m-0 u-caption">{l.description}</p> : null}
        </>
      ),
    },
    {
      id: 'original',
      header: 'Original',
      align: 'end',
      sortValue: (l) => Number(l.original),
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.original)}</span>,
    },
    {
      id: 'changes',
      header: 'Approved changes',
      align: 'end',
      sortValue: (l) => Number(l.approvedChanges),
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.approvedChanges)}</span>,
    },
    {
      id: 'revised',
      header: 'Revised',
      align: 'end',
      sortValue: (l) => Number(l.revised),
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.revised)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (l) =>
        locked ? (
          <Button size="sm" variant="secondary" onClick={() => setAdjusting(l.id)}>
            {canManage ? 'Adjust' : 'History'}
          </Button>
        ) : canManage ? (
          <span className="row-actions">
            <Button size="sm" variant="secondary" onClick={() => setEditing(l)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              loading={deleteLine.isPending && deleteLine.variables === l.id}
              onClick={() => deleteLine.mutate(l.id)}
            >
              Remove
            </Button>
          </span>
        ) : null,
    },
  ];

  if (q.isPending) return <SkeletonRows label="Loading budget…" />;
  if (q.error) return <ErrorAlert error={q.error} title="We couldn't load the budget" />;
  if (!budget) return null;

  // No budget row yet: the API returns an empty draft with no id.
  if (budget.id === null) {
    return (
      <div className="stack-lg">
        <ErrorAlert error={createBudget.error} title="We couldn't start the budget" />
        <EmptyState
          title="No budget yet"
          description="Set up your cost codes, then start a draft budget with one line per code. Lock it when it is agreed."
          action={
            canManage ? (
              <Button onClick={() => createBudget.mutate()} loading={createBudget.isPending}>
                Start the budget
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  const t = budget.totals;
  return (
    <div className="stack-lg">
      <div className="row-actions">
        <StatusPill tone={locked ? 'success' : 'warning'}>{locked ? 'Locked' : 'Draft'}</StatusPill>
        {locked && budget.lockedAt ? (
          <span className="u-caption">
            Locked {formatInstant(budget.lockedAt, project.timezone)}. Changes are now adjustments.
          </span>
        ) : (
          <span className="u-caption">Draft lines can be changed freely until you lock.</span>
        )}
        {!locked && canManage ? (
          <>
            <Button
              variant="secondary"
              onClick={() => setEditing('new')}
              disabled={available.length === 0}
            >
              Add line
            </Button>
            <Button variant="secondary" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Button onClick={() => setConfirmLock(true)} disabled={budget.lines.length === 0}>
              Lock budget
            </Button>
          </>
        ) : null}
      </div>
      {!locked && canManage && available.length === 0 ? (
        <Alert tone="info">
          Every active cost code already has a line. Add a cost code to budget more.
        </Alert>
      ) : null}
      <ErrorAlert error={lock.error ?? deleteLine.error} title="We couldn't update the budget" />
      <Card>
        <DescriptionList
          items={[
            {
              label: 'Original',
              value: <span className="u-mono u-nowrap">{aud(t.original)}</span>,
            },
            {
              label: 'Approved changes',
              value: <span className="u-mono u-nowrap">{aud(t.approvedChanges)}</span>,
            },
            { label: 'Revised', value: <span className="u-mono u-nowrap">{aud(t.revised)}</span> },
          ]}
        />
      </Card>
      <DataTable
        caption="Budget lines"
        columns={columns}
        rows={budget.lines}
        getRowId={(l) => l.id}
        defaultSort={{ columnId: 'code', direction: 'asc' }}
        empty={
          <EmptyState
            title="No lines yet"
            description="Add a line for each cost code you want to budget."
          />
        }
      />
      {editing ? (
        <LineDialog
          line={editing === 'new' ? null : editing}
          availableCodes={available}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? <ImportDialog onClose={() => setImporting(false)} /> : null}
      {adjustingLine ? (
        <AdjustDialog
          line={adjustingLine}
          canManage={canManage}
          onClose={() => setAdjusting(null)}
        />
      ) : null}
      <Dialog
        open={confirmLock}
        onClose={() => setConfirmLock(false)}
        title="Lock the budget?"
        description="The original amounts are frozen. After this, every change is an adjustment with a reason, and it cannot be undone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLock(false)}>
              Cancel
            </Button>
            <Button
              loading={lock.isPending}
              onClick={() => lock.mutate(undefined, { onSuccess: () => setConfirmLock(false) })}
            >
              Lock budget
            </Button>
          </>
        }
      />
    </div>
  );
}
