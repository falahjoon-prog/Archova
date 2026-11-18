'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { ProductionItemRow, ProductionRateFlag } from '../data/api';
import { useProductionReport } from '../hooks/useBudget';
import { ProductionCurve } from './ProductionCurve';
import { LogProductionCard, ProductionItemForm } from './ProductionForms';

const num = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 2 });
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const STATUS: Record<
  ProductionItemRow['status'],
  { tone: 'success' | 'danger' | 'neutral'; label: string }
> = {
  complete: { tone: 'success', label: 'Complete' },
  on_track: { tone: 'success', label: 'On track' },
  behind: { tone: 'danger', label: 'Behind plan' },
  not_started: { tone: 'neutral', label: 'Not started' },
};

/** Nova's plain-words reading of one rate flag. Rule-based; the numbers come straight from the report. */
const flagText = (f: ProductionRateFlag) =>
  `${f.kind === 'crew' ? 'Crew' : 'Trade'} ${f.name} is installing ${num(f.recentRate)} ${f.uom} a working day this week, ${pct(f.dropPct)} down on its ${num(f.baselineRate)} average over the previous four weeks.`;

/**
 * Production tracking: custom units (panels installed, LF of conduit, CY of concrete) with a planned quantity over a
 * planned window, quantity installed by day, and the planned-against-installed curve by trade and location. Nova
 * flags a trade or crew whose daily rate drops under its trailing four-week average, before a budget variance shows it.
 */
export function ProductionPanel({ canManage }: { canManage: boolean }) {
  const project = useCurrentProject();
  const [trade, setTrade] = useState('');
  const [location, setLocation] = useState('');
  const q = useProductionReport(project.projectId, {
    ...(trade ? { trade } : {}),
    ...(location ? { location } : {}),
  });
  const [logging, setLogging] = useState<ProductionItemRow | null>(null);
  const [adding, setAdding] = useState(false);

  if (q.isPending) return <SkeletonRows rows={5} />;
  if (q.error) return <ErrorAlert error={q.error} title="We couldn't load production tracking" />;
  const r = q.data;
  const names = (key: 'byTrade' | 'byLocation') => [
    ...new Set(r[key].map((x) => x.name).filter((n): n is string => n !== null)),
  ];

  const columns: DataTableColumn<ProductionItemRow>[] = [
    {
      id: 'name',
      header: 'Item',
      rowHeader: true,
      sortValue: (x) => x.item.name,
      cell: (x) => x.item.name,
    },
    { id: 'trade', header: 'Trade', cell: (x) => x.item.trade ?? '–' },
    { id: 'location', header: 'Location', cell: (x) => x.item.location ?? '–' },
    {
      id: 'planned',
      header: 'Planned',
      align: 'end',
      cell: (x) => (
        <span className="u-mono u-nowrap">
          {num(x.item.plannedQuantity)} {x.item.uom}
        </span>
      ),
    },
    {
      id: 'actual',
      header: 'Installed',
      align: 'end',
      cell: (x) => (
        <span className="u-mono u-nowrap">
          {num(x.actual)} ({pct(x.pctComplete)})
        </span>
      ),
    },
    {
      id: 'variance',
      header: 'Against plan to date',
      align: 'end',
      cell: (x) => (
        <span className={`u-mono u-nowrap${x.variance < 0 ? ' u-danger' : ''}`}>
          {x.variance > 0 ? '+' : ''}
          {num(x.variance)}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (x) => <StatusPill tone={STATUS[x.status].tone}>{STATUS[x.status].label}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      align: 'end' as const,
      cell: (x) => (
        <Button size="sm" variant="secondary" onClick={() => setLogging(x)}>
          Log quantity {x.item.name}
        </Button>
      ),
    },
  ];

  return (
    <div className="stack-lg">
      {r.flags.length > 0 ? (
        <Alert tone="warning" title="Nova: production rate is slipping">
          <ul className="stack-sm u-m-0">
            {r.flags.map((f) => (
              <li key={`${f.kind}:${f.name}:${f.uom}`}>{flagText(f)}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="form-row">
        <Select
          label="Trade"
          placeholder="All trades"
          options={names('byTrade').map((n) => ({ value: n, label: n }))}
          value={trade}
          onChange={(e) => setTrade(e.target.value)}
        />
        <Select
          label="Location"
          placeholder="All locations"
          options={names('byLocation').map((n) => ({ value: n, label: n }))}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>
      {r.curves.map((c) => (
        <Card key={c.uom} title={`Planned against installed: ${c.uom}`}>
          <ProductionCurve curve={c} />
        </Card>
      ))}
      <DataTable
        caption="Production items"
        columns={columns}
        rows={r.items}
        getRowId={(x) => x.item.id}
        defaultSort={{ columnId: 'name', direction: 'asc' }}
        rowClassName={(x) => (x.status === 'behind' ? 'row--flagged' : undefined)}
        empty={
          <EmptyState
            title="No production items yet"
            description="Define what the crews install, like panels, LF of conduit or CY of concrete, then log it each day."
          />
        }
      />
      {r.items.length > 0 ? (
        <div className="stack-lg">
          {(['byTrade', 'byLocation'] as const).map((key) => (
            <DataTable
              key={key}
              caption={key === 'byTrade' ? 'Installed by trade' : 'Installed by location'}
              columns={[
                {
                  id: 'name',
                  header: key === 'byTrade' ? 'Trade' : 'Location',
                  rowHeader: true,
                  cell: (x) => x.name ?? 'Not set',
                },
                { id: 'uom', header: 'Unit', cell: (x) => x.uom },
                {
                  id: 'planned',
                  header: 'Planned',
                  align: 'end',
                  cell: (x) => <span className="u-mono">{num(x.planned)}</span>,
                },
                {
                  id: 'actual',
                  header: 'Installed',
                  align: 'end',
                  cell: (x) => <span className="u-mono">{num(x.actual)}</span>,
                },
              ]}
              rows={r[key]}
              getRowId={(x) => `${x.name ?? ''}|${x.uom}`}
              density="compact"
            />
          ))}
        </div>
      ) : null}
      {logging ? (
        <LogProductionCard
          key={logging.item.id}
          itemId={logging.item.id}
          name={logging.item.name}
          uom={logging.item.uom}
          onDone={() => setLogging(null)}
        />
      ) : null}
      {canManage ? (
        adding ? (
          <ProductionItemForm onDone={() => setAdding(false)} />
        ) : (
          <div className="row-actions">
            <Button variant="secondary" onClick={() => setAdding(true)}>
              Add production item
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
