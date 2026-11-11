'use client';

import { DataTable, type DataTableColumn } from '@archova/ui';
import { formatLocalDate } from '@/shared/lib/format';
import type { ProductionCurve as Curve } from '../data/api';

const W = 560;
const H = 200;
const PAD = 32;
type Point = Curve['points'][number];

const num = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 2 });

/**
 * Planned against installed, cumulative by week, for one unit of measure. The figures are in the table under the
 * chart, so the chart never carries a number alone.
 */
export function ProductionCurve({ curve }: { curve: Curve }) {
  const { points, uom } = curve;
  if (points.length < 2) return null;
  const max = Math.max(1, ...points.map((p) => Math.max(p.planned, p.actual ?? 0)));
  const x = (i: number) => PAD + (i * (W - PAD * 2)) / (points.length - 1);
  const y = (v: number) => H - PAD - (v * (H - PAD * 2)) / max;
  const line = (pick: (p: Point) => number | null) =>
    points
      .map((p, i) => ({ i, v: pick(p) }))
      .filter((p): p is { i: number; v: number } => p.v !== null)
      .map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i)},${y(p.v)}`)
      .join(' ');
  const last = [...points].reverse().find((p) => p.actual !== null);

  const columns: DataTableColumn<Point>[] = [
    { id: 'date', header: 'Week ending', rowHeader: true, cell: (p) => formatLocalDate(p.date) },
    {
      id: 'planned',
      header: `Planned (${uom})`,
      align: 'end',
      cell: (p) => <span className="u-mono">{num(p.planned)}</span>,
    },
    {
      id: 'actual',
      header: `Installed (${uom})`,
      align: 'end',
      cell: (p) => <span className="u-mono">{p.actual === null ? '–' : num(p.actual)}</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Planned against installed ${uom}${last ? `: ${num(last.actual ?? 0)} installed of ${num(points[points.length - 1]!.planned)} planned` : ''}`}
        style={{ width: '100%', height: 'auto' }}
      >
        <path
          d={line((p) => p.planned)}
          fill="none"
          stroke="var(--c-text-secondary)"
          strokeWidth="2"
          strokeDasharray="6 4"
        />
        <path
          d={line((p) => p.actual)}
          fill="none"
          stroke="var(--c-action-primary)"
          strokeWidth="2.5"
        />
        <text x={PAD} y={14} fontSize="11" fill="var(--c-text-secondary)">
          {num(max)} {uom}
        </text>
        <text x={PAD} y={H - 8} fontSize="11" fill="var(--c-text-secondary)">
          Dashed: planned. Solid: installed.
        </text>
      </svg>
      <DataTable
        caption={`Planned and installed ${uom} by week`}
        columns={columns}
        rows={points}
        getRowId={(p) => p.date}
        density="compact"
      />
    </div>
  );
}
