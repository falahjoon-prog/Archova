'use client';

import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  SkeletonRows,
  StatGrid,
  TextField,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { InspectionsIcon, Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useCarbon, useEnvironmentMutations } from '../hooks/useEnvironment';
import {
  CARBON_SOURCE_INFO,
  CARBON_SOURCE_LABELS,
  type CarbonEntry,
  type CarbonInput,
  type CarbonSource,
} from '../lib/types';
import { MonthBars, monthLabel } from './Bars';

const SOURCES = Object.keys(CARBON_SOURCE_LABELS) as CarbonSource[];
const num = (n: number) => n.toLocaleString('en-AU', { maximumFractionDigits: 1 });
/** Tonnes CO2-e once it is a few hundred kilograms, otherwise kilograms. */
const co2 = (kg: number) => (kg >= 1000 ? `${num(kg / 1000)} t CO₂-e` : `${num(kg)} kg CO₂-e`);

export function CarbonTab() {
  const { entries, summary } = useCarbon();
  const m = useEnvironmentMutations();
  const [adding, setAdding] = useState(false);
  const s = summary.data;

  const columns: DataTableColumn<CarbonEntry>[] = [
    {
      id: 'date',
      header: 'Date',
      rowHeader: true,
      sortValue: (e) => e.entryDate,
      cell: (e) => formatLocalDate(e.entryDate),
    },
    {
      id: 'source',
      header: 'Activity',
      cell: (e) => (
        <>
          {CARBON_SOURCE_LABELS[e.source]}
          {e.description ? <div className="u-caption">{e.description}</div> : null}
        </>
      ),
    },
    {
      id: 'qty',
      header: 'Quantity',
      cell: (e) => `${num(e.quantity)} ${CARBON_SOURCE_INFO[e.source].unit}`,
    },
    { id: 'scope', header: 'Scope', cell: (e) => `Scope ${e.scope}` },
    { id: 'kg', header: 'Emissions', sortValue: (e) => e.kgCo2e, cell: (e) => co2(e.kgCo2e) },
    {
      id: 'actions',
      header: 'Actions',
      cell: (e) => (
        <Button
          variant="tertiary"
          aria-label={`Remove ${CARBON_SOURCE_LABELS[e.source]} entry of ${formatLocalDate(e.entryDate)}`}
          disabled={m.deleteCarbon.isPending}
          onClick={() => m.deleteCarbon.mutate(e)}
        >
          Remove
        </Button>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="u-row">
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Log fuel, power or materials
        </Button>
      </div>
      <ErrorAlert
        error={entries.error ?? summary.error ?? m.deleteCarbon.error}
        title="We couldn't load carbon"
      />
      {s ? (
        <>
          <StatGrid
            items={[
              { label: 'Total emissions', value: co2(s.totalKg) },
              {
                label: 'Last 30 days',
                value: co2(s.last30Kg),
                hint:
                  s.changePercent === null
                    ? 'Nothing to compare with yet'
                    : `${s.changePercent >= 0 ? 'Up' : 'Down'} ${Math.abs(s.changePercent)}% on the 30 before`,
                tone: s.changePercent !== null && s.changePercent >= 25 ? 'warning' : 'neutral',
              },
              { label: 'Scope 1 (fuel)', value: co2(s.byScope[1]) },
              {
                label: 'Scope 2 and 3',
                value: co2(s.byScope[2] + s.byScope[3]),
                hint: `Power ${co2(s.byScope[2])} · materials ${co2(s.byScope[3])}`,
              },
            ]}
          />
          {s.totalKg > 0 ? (
            <section className="stack" aria-label="Emissions by month">
              <h2 className="u-h3">Emissions by month</h2>
              <MonthBars
                label="Emissions in kg CO2-e, last six months"
                items={s.monthly.map((x) => ({
                  key: x.month,
                  label: monthLabel(x.month),
                  value: x.kg,
                }))}
                format={(v) => co2(v)}
              />
            </section>
          ) : null}
          {s.bySource.length > 0 ? (
            <DataTable
              caption="Emissions by activity"
              columns={[
                {
                  id: 'source',
                  header: 'Activity',
                  rowHeader: true,
                  cell: (r: (typeof s.bySource)[number]) => CARBON_SOURCE_LABELS[r.source],
                },
                {
                  id: 'qty',
                  header: 'Quantity',
                  cell: (r) => `${num(r.quantity)} ${CARBON_SOURCE_INFO[r.source].unit}`,
                },
                {
                  id: 'kg',
                  header: 'Emissions',
                  cell: (r) => `${co2(r.kg)} (${Math.round((r.kg / s.totalKg) * 100)}%)`,
                },
              ]}
              rows={s.bySource}
              getRowId={(r) => r.source}
            />
          ) : null}
        </>
      ) : summary.isPending ? (
        <SkeletonRows label="Loading carbon…" />
      ) : null}

      {entries.isPending ? null : (entries.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="Nothing logged yet"
          description="Log diesel and petrol, site power and the big materials such as concrete and steel to see the project's footprint."
        />
      ) : (
        <DataTable
          caption="Carbon entries"
          columns={columns}
          rows={entries.data ?? []}
          getRowId={(e) => e.id}
        />
      )}

      {adding ? (
        <CarbonDialog
          pending={m.createCarbon.isPending}
          error={m.createCarbon.error}
          onClose={() => setAdding(false)}
          onSave={(input) => m.createCarbon.mutate(input, { onSuccess: () => setAdding(false) })}
        />
      ) : null}
    </div>
  );
}

function CarbonDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: CarbonInput) => void;
}) {
  const project = useCurrentProject();
  const [entryDate, setDate] = useState(todayIn(project.timezone));
  const [source, setSource] = useState<CarbonSource>('diesel_litres');
  const [quantity, setQuantity] = useState('');
  const [factor, setFactor] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const info = CARBON_SOURCE_INFO[source];
  const qty = quantity.trim() === '' ? NaN : Number(quantity);
  const f = factor.trim() === '' ? info.factor : Number(factor);
  const valid = qty > 0 && f >= 0 && !Number.isNaN(f) && entryDate;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Log fuel, power or materials"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSave({
                entryDate,
                source,
                quantity: qty,
                ...(factor.trim() !== '' ? { factor: f } : {}),
                description: description.trim() || undefined,
                note: note.trim() || undefined,
              })
            }
          >
            {pending ? 'Saving…' : 'Log entry'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Date"
          type="date"
          value={entryDate}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select
          label="Activity"
          value={source}
          options={SOURCES.map((v) => ({ value: v, label: CARBON_SOURCE_LABELS[v] }))}
          onChange={(e) => {
            setSource(e.target.value as CarbonSource);
            setFactor('');
          }}
        />
        <TextField
          label={`Quantity (${info.unit})`}
          type="number"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <TextField
          label={`Emission factor (kg CO₂-e per ${info.unit})`}
          type="number"
          inputMode="decimal"
          value={factor}
          hint={`Leave blank to use ${info.factor}, an indicative default. Use your supplier's figure if you have one.`}
          onChange={(e) => setFactor(e.target.value)}
        />
        <p aria-live="polite">
          {qty > 0 && f >= 0 ? (
            <>
              This adds {co2(qty * f)} (scope {info.scope}).
            </>
          ) : null}
        </p>
        <TextField
          label="What for"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't log the entry" />
      </div>
    </Dialog>
  );
}
