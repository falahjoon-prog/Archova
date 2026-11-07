'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  SkeletonRows,
  Textarea,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetSnapshot } from '../data/api';
import { useBudget, useCreateSnapshot, useSnapshots } from '../hooks/useBudget';
import { aud } from '../lib/money';

type SnapLine = BudgetSnapshot['lines'][number];

/**
 * Snapshots freeze the budget as it stood at a moment, so a later adjustment can be compared with what was agreed.
 * A snapshot is never edited or deleted.
 */
export function SnapshotsPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const q = useSnapshots(project.projectId);
  const budget = useBudget(project.projectId);
  const create = useCreateSnapshot(project.projectId);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<BudgetSnapshot | null>(null);
  const hasBudget = budget.data?.id !== null && budget.data?.id !== undefined;

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim())
      return setError('Give the snapshot a name, like "Tender" or "After variations".');
    create.mutate(
      { name: name.trim(), ...(note.trim() ? { note: note.trim() } : {}) },
      {
        onSuccess: () => {
          setName('');
          setNote('');
        },
      },
    );
  }

  const columns: DataTableColumn<BudgetSnapshot>[] = [
    {
      id: 'name',
      header: 'Snapshot',
      rowHeader: true,
      sortValue: (x) => x.name,
      cell: (x) => (
        <>
          {x.name}
          {x.note ? <p className="u-m-0 u-caption">{x.note}</p> : null}
        </>
      ),
    },
    {
      id: 'taken',
      header: 'Taken',
      sortValue: (x) => x.takenAt,
      cell: (x) => <span className="u-nowrap">{formatInstant(x.takenAt, project.timezone)}</span>,
    },
    {
      id: 'revised',
      header: 'Revised then',
      align: 'end',
      sortValue: (x) => Number(x.totals.revised),
      cell: (x) => <span className="u-mono u-nowrap">{aud(x.totals.revised)}</span>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end',
      cell: (x) => (
        <Button size="sm" variant="secondary" onClick={() => setViewing(x)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      {canManage && hasBudget ? (
        <Card>
          <form className="stack" onSubmit={save} noValidate aria-label="Take a snapshot">
            <TextField
              label="Name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <ErrorAlert error={create.error} title="We couldn't take the snapshot" />
            <div>
              <Button type="submit" loading={create.isPending}>
                Take snapshot
              </Button>
            </div>
          </form>
        </Card>
      ) : null}
      <ErrorAlert error={q.error} title="We couldn't load the snapshots" />
      {q.isPending ? (
        <SkeletonRows label="Loading snapshots…" />
      ) : q.data ? (
        <DataTable
          caption="Budget snapshots"
          columns={columns}
          rows={q.data}
          getRowId={(x) => x.id}
          defaultSort={{ columnId: 'taken', direction: 'desc' }}
          empty={
            <EmptyState
              title="No snapshots yet"
              description={
                hasBudget
                  ? 'Take a snapshot to freeze the budget as it stands, then compare it later.'
                  : 'Start the budget first, then take a snapshot.'
              }
            />
          }
        />
      ) : null}
      {viewing ? (
        <SnapshotDialog
          snapshot={viewing}
          current={budget.data?.lines ?? []}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}

function SnapshotDialog({
  snapshot,
  current,
  onClose,
}: {
  snapshot: BudgetSnapshot;
  current: { costCodeId: string; revised: string }[];
  onClose: () => void;
}) {
  const now = (l: SnapLine) => current.find((c) => c.costCodeId === l.costCodeId)?.revised ?? null;
  const columns: DataTableColumn<SnapLine>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      cell: (l) => <span className="u-mono u-nowrap">{l.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (l) => l.codeDescription },
    {
      id: 'then',
      header: 'Revised then',
      align: 'end',
      cell: (l) => <span className="u-mono u-nowrap">{aud(l.revised)}</span>,
    },
    {
      id: 'now',
      header: 'Revised now',
      align: 'end',
      cell: (l) => {
        const n = now(l);
        return n === null ? '—' : <span className="u-mono u-nowrap">{aud(n)}</span>;
      },
    },
    {
      id: 'change',
      header: 'Change',
      align: 'end',
      cell: (l) => {
        const n = now(l);
        if (n === null) return '—';
        const d = Math.round((Number(n) - Number(l.revised)) * 100) / 100;
        return <span className="u-mono u-nowrap">{aud(d.toFixed(2))}</span>;
      },
    },
  ];
  return (
    <Dialog
      open
      onClose={onClose}
      title={snapshot.name}
      description={`Original ${aud(snapshot.totals.original)}, revised ${aud(snapshot.totals.revised)} when taken.`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <DataTable
        caption={`Lines in ${snapshot.name}`}
        columns={columns}
        rows={snapshot.lines}
        getRowId={(l) => l.costCodeId}
        density="compact"
        empty={<EmptyState title="No lines" description="This snapshot has no lines." />}
      />
    </Dialog>
  );
}
