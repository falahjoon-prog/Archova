'use client';

import { DataTable, EmptyState, type DataTableColumn } from '@archova/ui';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { BudgetSnapshot } from '../data/api';
import { aud } from '../lib/money';
import { trendPoints, type TrendPoint } from '../lib/snapshots';

const W = 560;
const H = 180;
const PAD = 28;

/**
 * Revised budget across the saved snapshots. Snapshots hold budget lines only, so projected cost and ECAC are not
 * charted here. The figures are in the table under the chart, so the chart never carries a number alone.
 */
export function SnapshotTrend({ snapshots }: { snapshots: BudgetSnapshot[] }) {
  const project = useCurrentProject();
  const points = trendPoints(snapshots);
  if (points.length < 2)
    return (
      <EmptyState
        title="Take two snapshots to see a trend"
        description="The trend line needs at least two snapshots."
      />
    );
  const values = points.map((p) => p.revised);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (points.length - 1);
  const y = (v: number) => H - PAD - ((v - min) * (H - PAD * 2)) / span;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p.revised)}`).join(' ');

  const columns: DataTableColumn<TrendPoint>[] = [
    { id: 'name', header: 'Snapshot', rowHeader: true, cell: (p) => p.name },
    {
      id: 'taken',
      header: 'Taken',
      cell: (p) => <span className="u-nowrap">{formatInstant(p.takenAt, project.timezone)}</span>,
    },
    {
      id: 'revised',
      header: 'Revised budget',
      align: 'end',
      cell: (p) => <span className="u-mono u-nowrap">{aud(p.revised.toFixed(2))}</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Revised budget across ${points.length} snapshots, from ${aud(values[0]!.toFixed(2))} to ${aud(values[values.length - 1]!.toFixed(2))}`}
        style={{ width: '100%', height: 'auto' }}
      >
        <path d={path} fill="none" stroke="var(--c-action-primary)" strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={p.id} cx={x(i)} cy={y(p.revised)} r="4" fill="var(--c-action-primary)" />
        ))}
        <text x={PAD} y={14} fontSize="11" fill="var(--c-text-secondary)">
          {aud(max.toFixed(2))}
        </text>
        <text x={PAD} y={H - 6} fontSize="11" fill="var(--c-text-secondary)">
          {aud(min.toFixed(2))}
        </text>
      </svg>
      <DataTable
        caption="Revised budget by snapshot"
        columns={columns}
        rows={points}
        getRowId={(p) => p.id}
        density="compact"
      />
    </div>
  );
}
