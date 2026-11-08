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
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { InspectionsIcon, Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useEnvironmentMutations, useWaste } from '../hooks/useEnvironment';
import {
  WASTE_DESTINATION_LABELS,
  WASTE_TYPE_LABELS,
  isDiverted,
  isRegulatedWaste,
  type DocketInput,
  type WasteDestination,
  type WasteDocket,
  type WasteType,
} from '../lib/types';
import { MonthBars, monthLabel } from './Bars';

const TYPES = Object.keys(WASTE_TYPE_LABELS) as WasteType[];
const DESTINATIONS = Object.keys(WASTE_DESTINATION_LABELS) as WasteDestination[];
const t = (n: number) => `${n.toLocaleString('en-AU', { maximumFractionDigits: 1 })} t`;

export function WasteTab() {
  const { dockets, summary } = useWaste();
  const m = useEnvironmentMutations();
  const [adding, setAdding] = useState(false);
  const s = summary.data;

  const columns: DataTableColumn<WasteDocket>[] = [
    {
      id: 'date',
      header: 'Date',
      rowHeader: true,
      sortValue: (d) => d.docketDate,
      cell: (d) => formatLocalDate(d.docketDate),
    },
    { id: 'type', header: 'Waste', cell: (d) => WASTE_TYPE_LABELS[d.wasteType] },
    { id: 'tonnes', header: 'Weight', sortValue: (d) => d.tonnes, cell: (d) => t(d.tonnes) },
    {
      id: 'dest',
      header: 'Went to',
      cell: (d) => (
        <StatusPill tone={isDiverted(d.destination) ? 'success' : 'neutral'}>
          {WASTE_DESTINATION_LABELS[d.destination]}
        </StatusPill>
      ),
    },
    {
      id: 'docket',
      header: 'Docket',
      cell: (d) => (
        <>
          {d.docketNumber ?? '—'}
          {isRegulatedWaste(d.wasteType) && d.evidenceCount === 0 ? (
            <StatusPill tone="danger">Copy missing</StatusPill>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (d) => (
        <Button
          variant="tertiary"
          aria-label={`Remove docket ${d.docketNumber ?? formatLocalDate(d.docketDate)}`}
          disabled={m.deleteDocket.isPending}
          onClick={() => m.deleteDocket.mutate(d)}
        >
          Remove
        </Button>
      ),
    },
  ];

  const change =
    s && s.last30.diversionPercent !== null && s.previous30.diversionPercent !== null
      ? s.last30.diversionPercent - s.previous30.diversionPercent
      : null;

  return (
    <div className="stack">
      <div className="u-row">
        <Button onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Add waste docket
        </Button>
      </div>
      <ErrorAlert
        error={dockets.error ?? summary.error ?? m.deleteDocket.error}
        title="We couldn't load waste"
      />
      {s ? (
        <>
          <StatGrid
            items={[
              {
                label: 'Diverted from landfill',
                value: s.diversionPercent === null ? '—' : `${s.diversionPercent}%`,
                hint: `Target ${s.targetPercent}%`,
                tone:
                  s.diversionPercent === null
                    ? 'neutral'
                    : s.diversionPercent >= s.targetPercent
                      ? 'success'
                      : 'warning',
              },
              {
                label: 'Total waste',
                value: t(s.totalTonnes),
                hint: `${t(s.divertedTonnes)} diverted`,
              },
              {
                label: 'To landfill',
                value: t(s.byDestination.landfill),
                tone: s.byDestination.landfill > 0 ? 'warning' : 'neutral',
              },
              {
                label: 'Last 30 days',
                value: s.last30.diversionPercent === null ? '—' : `${s.last30.diversionPercent}%`,
                hint:
                  change === null
                    ? 'Nothing to compare with yet'
                    : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)} points on the 30 before`,
                tone: change !== null && change < 0 ? 'warning' : 'neutral',
              },
            ]}
          />
          {s.totalTonnes > 0 ? (
            <section className="stack" aria-label="Diversion by month">
              <h2 className="u-h3">Diversion by month</h2>
              <MonthBars
                label="Share of waste diverted from landfill, last six months"
                max={100}
                target={s.targetPercent}
                items={s.monthly.map((x) => ({
                  key: x.month,
                  label: monthLabel(x.month),
                  value: x.diversionPercent,
                }))}
                format={(v) => `${v}%`}
              />
            </section>
          ) : null}
          {s.byType.length > 0 ? (
            <DataTable
              caption="Waste by type"
              columns={[
                {
                  id: 'type',
                  header: 'Waste',
                  rowHeader: true,
                  cell: (r: (typeof s.byType)[number]) => WASTE_TYPE_LABELS[r.wasteType],
                },
                { id: 'tonnes', header: 'Weight', cell: (r) => t(r.tonnes) },
                {
                  id: 'div',
                  header: 'Diverted',
                  cell: (r) => `${Math.round((r.divertedTonnes / r.tonnes) * 100)}%`,
                },
              ]}
              rows={s.byType}
              getRowId={(r) => r.wasteType}
            />
          ) : null}
        </>
      ) : summary.isPending ? (
        <SkeletonRows label="Loading waste…" />
      ) : null}

      {dockets.isPending ? null : (dockets.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="No waste dockets yet"
          description="Record each bin or truck that leaves site, with where it went, to see the diversion rate and spot streams going to landfill."
        />
      ) : (
        <DataTable
          caption="Waste dockets"
          columns={columns}
          rows={dockets.data ?? []}
          getRowId={(d) => d.id}
        />
      )}

      {adding ? (
        <DocketDialog
          pending={m.createDocket.isPending}
          error={m.createDocket.error}
          onClose={() => setAdding(false)}
          onSave={(input) => m.createDocket.mutate(input, { onSuccess: () => setAdding(false) })}
        />
      ) : null}
    </div>
  );
}

function DocketDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: DocketInput) => void;
}) {
  const project = useCurrentProject();
  const [docketDate, setDate] = useState(todayIn(project.timezone));
  const [wasteType, setType] = useState<WasteType>('general');
  const [destination, setDestination] = useState<WasteDestination>('landfill');
  const [tonnes, setTonnes] = useState('');
  const [docketNumber, setNumber] = useState('');
  const [contractor, setContractor] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const weight = tonnes.trim() === '' ? NaN : Number(tonnes);
  const regulated = isRegulatedWaste(wasteType);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add waste docket"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!(weight > 0) || !docketDate || pending}
            onClick={() =>
              onSave({
                docketDate,
                wasteType,
                destination,
                tonnes: weight,
                docketNumber: docketNumber.trim() || undefined,
                contractor: contractor.trim() || undefined,
                note: note.trim() || undefined,
                files,
              })
            }
          >
            {pending ? 'Saving…' : 'Add docket'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label="Date"
          type="date"
          value={docketDate}
          onChange={(e) => setDate(e.target.value)}
        />
        <Select
          label="Waste"
          value={wasteType}
          options={TYPES.map((v) => ({ value: v, label: WASTE_TYPE_LABELS[v] }))}
          onChange={(e) => setType(e.target.value as WasteType)}
        />
        <TextField
          label="Weight (tonnes)"
          type="number"
          inputMode="decimal"
          value={tonnes}
          onChange={(e) => setTonnes(e.target.value)}
        />
        <Select
          label="Where it went"
          value={destination}
          options={DESTINATIONS.map((v) => ({ value: v, label: WASTE_DESTINATION_LABELS[v] }))}
          onChange={(e) => setDestination(e.target.value as WasteDestination)}
        />
        <TextField
          label="Docket number"
          value={docketNumber}
          onChange={(e) => setNumber(e.target.value)}
        />
        <TextField
          label="Contractor"
          value={contractor}
          onChange={(e) => setContractor(e.target.value)}
        />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="u-caption">
          {regulated ? 'Signed docket (required for this waste)' : 'Copy of the docket'}
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <ErrorAlert error={error} title="We couldn't add the docket" />
      </div>
    </Dialog>
  );
}
