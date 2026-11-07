'use client';

import { useState } from 'react';
import { DataTable, EmptyState, Select, StatusPill, type DataTableColumn } from '@archova/ui';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetSnapshot } from '../data/api';
import { compareSnapshots, type CompareRow } from '../lib/snapshots';
import { aud } from '../lib/money';

const TONE = { added: 'info', removed: 'warning', changed: 'neutral', same: 'neutral' } as const;
const LABEL = {
  added: 'Added',
  removed: 'Removed',
  changed: 'Changed',
  same: 'No change',
} as const;

/** Pick two snapshots and see every cost code side by side, with what moved between them. */
export function SnapshotCompare({ snapshots }: { snapshots: BudgetSnapshot[] }) {
  const project = useCurrentProject();
  const ordered = [...snapshots].sort((x, y) => x.takenAt.localeCompare(y.takenAt));
  const [aId, setAId] = useState('');
  const [bId, setBId] = useState('');
  const a = ordered.find((s) => s.id === aId);
  const b = ordered.find((s) => s.id === bId);
  const options = ordered.map((s) => ({
    value: s.id,
    label: `${s.name}, ${formatInstant(s.takenAt, project.timezone)}`,
  }));

  const columns: DataTableColumn<CompareRow>[] = [
    {
      id: 'code',
      header: 'Code',
      rowHeader: true,
      sortValue: (r) => r.code,
      cell: (r) => <span className="u-mono u-nowrap">{r.code}</span>,
    },
    { id: 'description', header: 'Description', cell: (r) => r.codeDescription },
    {
      id: 'a',
      header: a?.name ?? 'First',
      align: 'end',
      cell: (r) => (r.a === null ? '—' : <span className="u-mono u-nowrap">{aud(r.a)}</span>),
    },
    {
      id: 'b',
      header: b?.name ?? 'Second',
      align: 'end',
      cell: (r) => (r.b === null ? '—' : <span className="u-mono u-nowrap">{aud(r.b)}</span>),
    },
    {
      id: 'change',
      header: 'Change',
      align: 'end',
      sortValue: (r) => Number(r.change),
      cell: (r) => <span className="u-mono u-nowrap">{aud(r.change)}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusPill tone={TONE[r.status]}>{LABEL[r.status]}</StatusPill>,
    },
  ];

  if (snapshots.length < 2)
    return (
      <EmptyState
        title="Take two snapshots to compare"
        description="Comparing needs at least two. Take another after the budget changes."
      />
    );

  return (
    <div className="stack-lg">
      <div className="form-row">
        <Select
          label="First snapshot"
          placeholder="Choose a snapshot"
          options={options}
          value={aId}
          onChange={(e) => setAId(e.target.value)}
        />
        <Select
          label="Second snapshot"
          placeholder="Choose a snapshot"
          options={options}
          value={bId}
          onChange={(e) => setBId(e.target.value)}
        />
      </div>
      {a && b ? (
        <DataTable
          caption={`Revised budget in ${a.name} compared with ${b.name}`}
          columns={columns}
          rows={compareSnapshots(a, b)}
          getRowId={(r) => r.costCodeId}
          defaultSort={{ columnId: 'code', direction: 'asc' }}
          empty={<EmptyState title="No lines" description="Neither snapshot has any lines." />}
        />
      ) : (
        <EmptyState
          title="Choose two snapshots"
          description="Pick a first and a second to see what changed."
        />
      )}
    </div>
  );
}
