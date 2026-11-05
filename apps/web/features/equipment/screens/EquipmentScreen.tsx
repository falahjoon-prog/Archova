'use client';

import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { addDays } from '@archova/time';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Equipment, EquipmentBooking, EquipmentStatus } from '../data/api';
import {
  useEquipmentBookings,
  useEquipmentList,
  useEquipmentLogs,
  useEquipmentMutations,
} from '../hooks/useEquipment';

const STATUS_LABELS: Record<EquipmentStatus, string> = {
  available: 'Available',
  in_use: 'In use',
  maintenance: 'Maintenance',
  retired: 'Retired',
};
const TONE = {
  available: 'success',
  in_use: 'info',
  maintenance: 'warning',
  retired: 'neutral',
} as const;
const WINDOW_DAYS = 30;
const QUARTER = /^\d{1,2}(\.\d{1,2})?$/;

type Mutations = ReturnType<typeof useEquipmentMutations>;

/**
 * The project's machines: what is on site, who has each booked and when, and the hours it has run. Site managers
 * keep the register and bookings; anyone on site can log hours.
 */
export function EquipmentScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'equipment', id: 'register' },
  });
  const canManage =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.workforce, 'admin');
  const today = todayIn(project.timezone);
  const list = useEquipmentList(project.projectId);
  const bookings = useEquipmentBookings(project.projectId, today, addDays(today, WINDOW_DAYS));
  const m = useEquipmentMutations(project.projectId);
  const name = (id: string) => list.data?.find((e) => e.id === id)?.name ?? 'Machine';

  const machines: DataTableColumn<Equipment>[] = [
    { id: 'name', header: 'Machine', rowHeader: true, cell: (e) => e.name },
    {
      id: 'asset',
      header: 'Asset no.',
      cell: (e) => <span className="u-mono">{e.assetNumber}</span>,
    },
    { id: 'type', header: 'Type', cell: (e) => e.type },
    {
      id: 'status',
      header: 'Status',
      cell: (e) =>
        canManage ? (
          <select
            className="ac-input ac-select"
            style={{ minWidth: '8rem' }}
            aria-label={`Status of ${e.name}`}
            value={e.status}
            onChange={(ev) =>
              m.setStatus.mutate({ equipmentId: e.id, status: ev.target.value as EquipmentStatus })
            }
          >
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        ) : (
          <StatusPill tone={TONE[e.status]}>{STATUS_LABELS[e.status]}</StatusPill>
        ),
    },
  ];

  const booked: DataTableColumn<EquipmentBooking>[] = [
    { id: 'machine', header: 'Machine', rowHeader: true, cell: (b) => name(b.equipmentId) },
    {
      id: 'dates',
      header: 'Dates',
      sortValue: (b) => b.startsOn,
      cell: (b) => `${formatLocalDate(b.startsOn)} to ${formatLocalDate(b.endsOn)}`,
    },
    { id: 'for', header: 'Booked for', cell: (b) => b.bookedFor },
    {
      id: 'status',
      header: 'Status',
      cell: (b) => (
        <StatusPill tone={b.status === 'active' ? 'success' : 'neutral'}>
          {b.status === 'active' ? 'Booked' : 'Cancelled'}
        </StatusPill>
      ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (b: EquipmentBooking) =>
              b.status === 'active' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={m.cancelBooking.isPending}
                  onClick={() =>
                    m.cancelBooking.mutate({ equipmentId: b.equipmentId, bookingId: b.id })
                  }
                >
                  Cancel booking of {name(b.equipmentId)}
                </Button>
              ) : null,
          } satisfies DataTableColumn<EquipmentBooking>,
        ]
      : []),
  ];

  if (list.isPending || perms.isPending) return <SkeletonRows label="Loading equipment…" />;
  const machinesList = list.data ?? [];
  return (
    <div className="stack-lg">
      <PageHeader
        title="Equipment"
        description="Machines on this project, who has them booked, and the hours they run."
      />
      <ErrorAlert error={list.error} title="We couldn't load the equipment" />
      <ErrorAlert
        error={m.setStatus.error ?? m.cancelBooking.error}
        title="We couldn't update that"
      />
      <DataTable
        caption="Equipment register"
        columns={machines}
        rows={machinesList}
        getRowId={(e) => e.id}
        empty={
          <EmptyState
            title="No equipment yet"
            description={canManage ? 'Add a machine below.' : 'Nothing has been registered.'}
          />
        }
      />
      <DataTable
        caption={`Bookings, next ${WINDOW_DAYS} days`}
        columns={booked}
        rows={bookings.data ?? []}
        getRowId={(b) => b.id}
        empty={<EmptyState title="No bookings" description="Nothing is booked in this window." />}
      />
      {canManage ? <BookForm machines={machinesList} today={today} m={m} /> : null}
      <LogForm machines={machinesList} today={today} projectId={project.projectId} m={m} />
      {canManage ? <AddForm m={m} /> : null}
    </div>
  );
}

function BookForm({ machines, today, m }: { machines: Equipment[]; today: string; m: Mutations }) {
  const [equipmentId, setEquipmentId] = useState('');
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [bookedFor, setBookedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!equipmentId) return setError('Choose the machine.');
    if (!bookedFor.trim()) return setError('Say who or what the machine is booked for.');
    if (endsOn < startsOn) return setError('The booking must not end before it starts.');
    m.book.mutate(
      { equipmentId, body: { startsOn, endsOn, bookedFor: bookedFor.trim() } },
      { onSuccess: () => setBookedFor('') },
    );
  }
  return (
    <Card title="Book a machine">
      <form className="stack-lg" onSubmit={save} noValidate>
        <Select
          label="Machine"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          options={[
            { value: '', label: 'Choose a machine' },
            ...machines
              .filter((x) => x.status === 'available' || x.status === 'in_use')
              .map((x) => ({ value: x.id, label: `${x.name} (${x.assetNumber})` })),
          ]}
        />
        <div className="form-row">
          <TextField
            label="From"
            type="date"
            required
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
          />
          <TextField
            label="To"
            type="date"
            required
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
          />
        </div>
        <TextField
          label="Booked for"
          required
          value={bookedFor}
          onChange={(e) => setBookedFor(e.target.value)}
        />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.book.error} title="We couldn't book this machine" />
        <div className="row-actions">
          <Button type="submit" disabled={m.book.isPending}>
            {m.book.isPending ? 'Saving…' : 'Book machine'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function LogForm({
  machines,
  today,
  projectId,
  m,
}: {
  machines: Equipment[];
  today: string;
  projectId: string;
  m: Mutations;
}) {
  const [equipmentId, setEquipmentId] = useState('');
  const [date, setDate] = useState(today);
  const [hours, setHours] = useState('');
  const [operator, setOperator] = useState('');
  const [error, setError] = useState<string | null>(null);
  const logs = useEquipmentLogs(projectId, equipmentId);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const h = hours.trim();
    if (!equipmentId) return setError('Choose the machine.');
    if (
      !QUARTER.test(h) ||
      Number(h) <= 0 ||
      Number(h) > 24 ||
      Math.round(Number(h) * 4) !== Number(h) * 4
    )
      return setError('Enter hours in quarter hours, up to 24, for example 7.5.');
    m.logHours.mutate(
      {
        equipmentId,
        body: { date, hours: h, ...(operator.trim() ? { operator: operator.trim() } : {}) },
      },
      { onSuccess: () => setHours('') },
    );
  }
  return (
    <Card title="Log hours">
      <form className="stack-lg" onSubmit={save} noValidate>
        <Select
          label="Machine"
          value={equipmentId}
          onChange={(e) => setEquipmentId(e.target.value)}
          options={[
            { value: '', label: 'Choose a machine' },
            ...machines
              .filter((x) => x.status !== 'retired')
              .map((x) => ({ value: x.id, label: `${x.name} (${x.assetNumber})` })),
          ]}
        />
        <div className="form-row">
          <TextField
            label="Date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Hours"
            inputMode="decimal"
            required
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
          <TextField
            label="Operator"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
          />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.logHours.error} title="We couldn't log those hours" />
        <div className="row-actions">
          <Button type="submit" disabled={m.logHours.isPending}>
            {m.logHours.isPending ? 'Saving…' : 'Log hours'}
          </Button>
        </div>
      </form>
      {equipmentId && (logs.data ?? []).length > 0 ? (
        <ul className="stack-sm">
          {(logs.data ?? []).slice(0, 10).map((l) => (
            <li key={l.id}>
              {formatLocalDate(l.date)}: <span className="u-mono">{l.hours}</span> h
              {l.operator ? `, ${l.operator}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function AddForm({ m }: { m: Mutations }) {
  const [name, setName] = useState('');
  const [assetNumber, setAssetNumber] = useState('');
  const [type, setType] = useState('');
  const [error, setError] = useState<string | null>(null);
  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim() || !assetNumber.trim() || !type.trim())
      return setError('Enter the name, asset number and type.');
    m.create.mutate(
      { name: name.trim(), assetNumber: assetNumber.trim(), type: type.trim() },
      {
        onSuccess: () => {
          setName('');
          setAssetNumber('');
          setType('');
        },
      },
    );
  }
  return (
    <Card title="Add a machine">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <TextField label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <TextField
            label="Asset number"
            required
            value={assetNumber}
            onChange={(e) => setAssetNumber(e.target.value)}
          />
          <TextField label="Type" required value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.create.error} title="We couldn't add this machine" />
        <div className="row-actions">
          <Button type="submit" disabled={m.create.isPending}>
            {m.create.isPending ? 'Saving…' : 'Add machine'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
