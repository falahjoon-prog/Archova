'use client';

import { useState } from 'react';
import {
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { InspectionsIcon, Plus } from '@archova/ui/icons';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useEnvironmentMutations, useMonitoringPoints, useReadings } from '../hooks/useEnvironment';
import {
  MONITORING_FREQUENCY_LABELS,
  PARAMETER_DEFAULTS,
  PARAMETER_LABELS,
  READING_STATUS_LABELS,
  type MonitoringFrequency,
  type MonitoringParameter,
  type MonitoringPoint,
  type Reading,
  type ReadingStatus,
} from '../lib/types';

const PARAMETERS = Object.keys(PARAMETER_LABELS) as MonitoringParameter[];
const MONITORING_FREQUENCIES = Object.keys(MONITORING_FREQUENCY_LABELS) as MonitoringFrequency[];
const READING_TONE: Record<ReadingStatus, StatusTone> = {
  ok: 'success',
  warning: 'warning',
  breach: 'danger',
};

const limitText = (p: MonitoringPoint) => {
  if (p.minLimit !== null && p.maxLimit !== null) return `${p.minLimit} to ${p.maxLimit} ${p.unit}`;
  if (p.maxLimit !== null) return `max ${p.maxLimit} ${p.unit}`;
  return `min ${p.minLimit} ${p.unit}`;
};

/** A tiny trend line of the latest readings, with the maximum limit drawn as a dashed line. */
function Sparkline({ values, max }: { values: number[]; max: number | null }) {
  if (values.length < 2) return <span className="u-caption">Not enough readings</span>;
  const w = 96;
  const h = 28;
  const top = Math.max(...values, max ?? -Infinity);
  const bottom = Math.min(...values);
  const span = top - bottom || 1;
  const y = (v: number) => h - 2 - ((v - bottom) / span) * (h - 4);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(' ');
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      role="img"
      aria-label={`Last ${values.length} readings, from ${values[0]} to ${values[values.length - 1]}`}
    >
      {max !== null ? (
        <line
          x1="0"
          x2={w}
          y1={y(max)}
          y2={y(max)}
          stroke="currentColor"
          strokeDasharray="3 3"
          opacity="0.4"
        />
      ) : null}
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" points={pts} />
    </svg>
  );
}

export type MonitoringDialog =
  | { kind: 'point' }
  | { kind: 'log'; point: MonitoringPoint }
  | { kind: 'respond'; reading: Reading }
  | null;

export function MonitoringTab() {
  const project = useCurrentProject();
  const points = useMonitoringPoints();
  const breaches = useReadings({ status: 'breach', open: true });
  const m = useEnvironmentMutations();
  const [dialog, setDialog] = useState<MonitoringDialog>(null);

  const columns: DataTableColumn<MonitoringPoint>[] = [
    {
      id: 'name',
      header: 'Monitoring point',
      rowHeader: true,
      cell: (p) => (
        <>
          {p.name}
          <div className="u-caption">
            {PARAMETER_LABELS[p.parameter]} · {MONITORING_FREQUENCY_LABELS[p.frequency]}
          </div>
        </>
      ),
    },
    { id: 'limit', header: 'Limit', cell: (p) => limitText(p) },
    {
      id: 'latest',
      header: 'Latest',
      cell: (p) =>
        p.latest ? (
          <>
            {p.latest.value} {p.unit}{' '}
            <StatusPill tone={READING_TONE[p.latest.status]}>
              {READING_STATUS_LABELS[p.latest.status]}
            </StatusPill>
            <div className="u-caption">{formatInstant(p.latest.takenAt, project.timezone)}</div>
          </>
        ) : (
          'No readings yet'
        ),
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: (p) => (
        <>
          <Sparkline values={p.recent} max={p.maxLimit} />
          {p.isTrending ? <StatusPill tone="warning">Rising</StatusPill> : null}
          {p.isOverdue ? <StatusPill tone="warning">Reading overdue</StatusPill> : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (p) => (
        <Button
          variant="secondary"
          aria-label={`Log a reading for ${p.name}`}
          onClick={() => setDialog({ kind: 'log', point: p })}
        >
          Log reading
        </Button>
      ),
    },
  ];

  const open = breaches.data ?? [];
  return (
    <div className="stack">
      <div className="u-row">
        <Button onClick={() => setDialog({ kind: 'point' })}>
          <Plus size={16} aria-hidden="true" /> Add monitoring point
        </Button>
      </div>
      <ErrorAlert error={points.error ?? breaches.error} title="We couldn't load monitoring" />

      {open.length > 0 ? (
        <section aria-label="Breaches to answer" className="stack">
          <h2 className="u-h3">Breaches to answer</h2>
          <DataTable
            caption="Breaches waiting for a response"
            columns={[
              {
                id: 'point',
                header: 'Point',
                rowHeader: true,
                cell: (r: Reading) => r.pointName ?? r.pointId,
              },
              {
                id: 'value',
                header: 'Reading',
                cell: (r: Reading) => `${r.value} ${r.unit ?? ''}`.trim(),
              },
              {
                id: 'at',
                header: 'Taken',
                cell: (r: Reading) => formatInstant(r.takenAt, project.timezone),
              },
              {
                id: 'act',
                header: 'Actions',
                cell: (r: Reading) => (
                  <Button
                    aria-label={`Respond to the breach at ${r.pointName ?? r.pointId}`}
                    onClick={() => setDialog({ kind: 'respond', reading: r })}
                  >
                    Respond
                  </Button>
                ),
              },
            ]}
            rows={open}
            getRowId={(r) => r.id}
          />
        </section>
      ) : null}

      {points.isPending ? (
        <SkeletonRows label="Loading monitoring points…" />
      ) : (points.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="No monitoring points yet"
          description="Add a dust, noise, vibration or water point with its limits. Readings are checked against the limits and a breach flags the linked condition."
        />
      ) : (
        <DataTable
          caption="Monitoring points"
          columns={columns}
          rows={points.data ?? []}
          getRowId={(p) => p.id}
        />
      )}

      {dialog?.kind === 'point' ? (
        <PointDialog
          pending={m.createPoint.isPending}
          error={m.createPoint.error}
          onClose={() => setDialog(null)}
          onSave={(input) => m.createPoint.mutate(input, { onSuccess: () => setDialog(null) })}
        />
      ) : null}
      {dialog?.kind === 'log' ? (
        <LogDialog
          point={dialog.point}
          pending={m.logReading.isPending}
          error={m.logReading.error}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            m.logReading.mutate(
              { point: dialog.point, input },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
      {dialog?.kind === 'respond' ? (
        <RespondDialog
          reading={dialog.reading}
          pending={m.respond.isPending}
          error={m.respond.error}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            m.respond.mutate(
              { reading: dialog.reading, input },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
    </div>
  );
}

function PointDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: {
    name: string;
    parameter: MonitoringParameter;
    unit: string;
    location?: string;
    minLimit?: number | null;
    maxLimit?: number | null;
    frequency: MonitoringFrequency;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [parameter, setParameter] = useState<MonitoringParameter>('dust_pm10');
  const [unit, setUnit] = useState(PARAMETER_DEFAULTS.dust_pm10.unit);
  const [min, setMin] = useState('');
  const [max, setMax] = useState(String(PARAMETER_DEFAULTS.dust_pm10.maxLimit));
  const [location, setLocation] = useState('');
  const [frequency, setFrequency] = useState<MonitoringFrequency>('daily');
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  const valid =
    name.trim() &&
    unit.trim() &&
    (num(min) !== null || num(max) !== null) &&
    !Number.isNaN(num(min) ?? 0) &&
    !Number.isNaN(num(max) ?? 0);
  // Picking a parameter prefills the usual unit and limit; every value stays editable.
  const pick = (p: MonitoringParameter) => {
    const d = PARAMETER_DEFAULTS[p];
    setParameter(p);
    setUnit(d.unit);
    setMin(d.minLimit === undefined ? '' : String(d.minLimit));
    setMax(d.maxLimit === undefined ? '' : String(d.maxLimit));
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add monitoring point"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!valid || pending}
            onClick={() =>
              onSave({
                name: name.trim(),
                parameter,
                unit: unit.trim(),
                location: location.trim() || undefined,
                minLimit: num(min),
                maxLimit: num(max),
                frequency,
              })
            }
          >
            {pending ? 'Saving…' : 'Add point'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Select
          label="Parameter"
          value={parameter}
          options={PARAMETERS.map((v) => ({ value: v, label: PARAMETER_LABELS[v] }))}
          onChange={(e) => pick(e.target.value as MonitoringParameter)}
        />
        <TextField label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
        <TextField
          label="Minimum limit"
          type="number"
          inputMode="decimal"
          value={min}
          onChange={(e) => setMin(e.target.value)}
        />
        <TextField
          label="Maximum limit"
          type="number"
          inputMode="decimal"
          value={max}
          hint="Set at least one limit, from your permit or EPA licence."
          onChange={(e) => setMax(e.target.value)}
        />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Select
          label="How often"
          value={frequency}
          options={MONITORING_FREQUENCIES.map((v) => ({
            value: v,
            label: MONITORING_FREQUENCY_LABELS[v],
          }))}
          onChange={(e) => setFrequency(e.target.value as MonitoringFrequency)}
        />
        <ErrorAlert error={error} title="We couldn't add the point" />
      </div>
    </Dialog>
  );
}

function LogDialog({
  point,
  pending,
  error,
  onClose,
  onSave,
}: {
  point: MonitoringPoint;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: { value: number; note?: string; files: File[] }) => void;
}) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const parsed = value.trim() === '' ? NaN : Number(value);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Log reading: ${point.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={Number.isNaN(parsed) || pending}
            onClick={() => onSave({ value: parsed, note: note.trim() || undefined, files })}
          >
            {pending ? 'Saving…' : 'Log reading'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField
          label={`Reading (${point.unit})`}
          type="number"
          inputMode="decimal"
          value={value}
          hint={`Limit: ${limitText(point)}. A reading outside it is a breach.`}
          onChange={(e) => setValue(e.target.value)}
        />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="u-caption">
          Photos or logger export
          <input
            type="file"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
        </label>
        <ErrorAlert error={error} title="We couldn't log the reading" />
      </div>
    </Dialog>
  );
}

function RespondDialog({
  reading,
  pending,
  error,
  onClose,
  onSave,
}: {
  reading: Reading;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: { note: string; raiseIncident: boolean }) => void;
}) {
  const [note, setNote] = useState('');
  const [raise, setRaise] = useState(true);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Respond to breach: ${reading.pointName ?? ''}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!note.trim() || pending}
            onClick={() => onSave({ note: note.trim(), raiseIncident: raise })}
          >
            {pending ? 'Saving…' : 'Record response'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p>
          Reading of {reading.value} {reading.unit}. Say what you did to bring it back within
          limits.
        </p>
        <Textarea
          label="Corrective action"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Checkbox
          label="Also report an environmental incident"
          hint="Adds it to the incident register so it follows the normal investigation."
          checked={raise}
          onChange={(e) => setRaise(e.target.checked)}
        />
        <ErrorAlert error={error} title="We couldn't record the response" />
      </div>
    </Dialog>
  );
}
