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
  Textarea,
  type DataTableColumn,
} from '@archova/ui';
import { atLeast } from '@archova/domain/permissions';
import { addDays, zonedToUtc } from '@archova/time';
import { usePublishAssistantScope } from '@/features/assistant';
import { useSites, useWorkers } from '@/features/attendance';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatInstant, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Shift, ShiftAssignment, ShiftStatus } from '../data/api';
import { useRosterMutations, useShifts } from '../hooks/useRoster';

const STATUS_LABELS: Record<ShiftStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  cancelled: 'Cancelled',
};
const STATUS_TONE = { draft: 'neutral', published: 'success', cancelled: 'danger' } as const;
const RESPONSE_LABELS: Record<ShiftAssignment['status'], string> = {
  offered: 'Offered',
  accepted: 'Accepted',
  declined: 'Declined',
  no_show: 'No show',
  attended: 'Attended',
};
const WINDOW_DAYS = 14;

/**
 * Shifts for the next fortnight: site managers draft a shift, put workers on it and publish it; a subcontractor
 * sees only its own workers and answers for them (ATT-US11). Times are shown and entered in project time.
 */
export function RosterScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'roster', id: 'shifts' },
  });
  const canManage =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.workforce, 'admin');
  const [startDate, setStartDate] = useState(() => todayIn(project.timezone));
  const from = zonedToUtc(startDate, '00:00', project.timezone).toISOString();
  const to = zonedToUtc(addDays(startDate, WINDOW_DAYS), '00:00', project.timezone).toISOString();
  const q = useShifts(project.projectId, from, to);
  const sites = useSites();
  const workers = useWorkers({});
  const m = useRosterMutations(project.projectId);
  const siteName = (id: string) => sites.data?.find((s) => s.id === id)?.name ?? 'Site';
  const workerName = (id: string) => workers.data?.find((w) => w.id === id)?.fullName ?? 'Worker';

  const columns: DataTableColumn<Shift>[] = [
    {
      id: 'when',
      header: 'When',
      rowHeader: true,
      sortValue: (s) => s.startsAt,
      cell: (s) =>
        `${formatInstant(s.startsAt, project.timezone)} to ${formatInstant(s.endsAt, project.timezone)}`,
    },
    { id: 'site', header: 'Site', cell: (s) => siteName(s.siteId) },
    { id: 'trade', header: 'Trade', cell: (s) => [s.trade, s.crew].filter(Boolean).join(', ') },
    {
      id: 'filled',
      header: 'Filled',
      align: 'end',
      cell: (s) => `${s.filled} of ${s.requiredHeadcount}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => <StatusPill tone={STATUS_TONE[s.status]}>{STATUS_LABELS[s.status]}</StatusPill>,
    },
    {
      id: 'workers',
      header: 'Workers',
      cell: (s) =>
        s.assignments.length === 0 ? (
          '—'
        ) : (
          <ul className="stack-sm">
            {s.assignments.map((a) => (
              <li key={a.id}>
                {workerName(a.workerId)}: {RESPONSE_LABELS[a.status]}{' '}
                {s.status !== 'cancelled' && a.status === 'offered' ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={m.respond.isPending}
                      onClick={() =>
                        m.respond.mutate({ shiftId: s.id, assignmentId: a.id, status: 'accepted' })
                      }
                    >
                      Accept for {workerName(a.workerId)}
                    </Button>{' '}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={m.respond.isPending}
                      onClick={() =>
                        m.respond.mutate({ shiftId: s.id, assignmentId: a.id, status: 'declined' })
                      }
                    >
                      Decline for {workerName(a.workerId)}
                    </Button>{' '}
                  </>
                ) : null}
                {canManage && s.status !== 'cancelled' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={m.unassign.isPending}
                    onClick={() => m.unassign.mutate({ shiftId: s.id, assignmentId: a.id })}
                  >
                    Remove {workerName(a.workerId)}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (s: Shift) => (
              <span className="row-actions">
                {s.status === 'draft' ? (
                  <Button
                    size="sm"
                    disabled={m.publish.isPending}
                    onClick={() => m.publish.mutate(s.id)}
                  >
                    Publish
                  </Button>
                ) : null}
                {s.status !== 'cancelled' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={m.cancel.isPending}
                    onClick={() => m.cancel.mutate(s.id)}
                  >
                    Cancel shift
                  </Button>
                ) : null}
              </span>
            ),
          } satisfies DataTableColumn<Shift>,
        ]
      : []),
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Roster"
        description={`Shifts for the next ${WINDOW_DAYS} days from the date you pick. Times are in project time (${project.timezone}).`}
      />
      <TextField
        label="From"
        type="date"
        value={startDate}
        onChange={(e) => e.target.value && setStartDate(e.target.value)}
      />
      <ErrorAlert
        error={
          m.publish.error ?? m.cancel.error ?? m.assign.error ?? m.unassign.error ?? m.respond.error
        }
        title="We couldn't update that shift"
      />
      {q.isPending || perms.isPending ? (
        <SkeletonRows label="Loading the roster…" />
      ) : q.isError ? (
        <ErrorAlert error={q.error} title="We couldn't load the roster" />
      ) : (
        <DataTable
          caption="Shifts"
          columns={columns}
          rows={q.data}
          getRowId={(s) => s.id}
          empty={
            <EmptyState
              title="No shifts in this window"
              description={
                canManage ? 'Draft a shift below.' : 'Nothing has been rostered for your crews yet.'
              }
            />
          }
        />
      )}
      {canManage ? (
        <>
          <AssignPanel
            shifts={(q.data ?? []).filter((s) => s.status !== 'cancelled')}
            workers={(workers.data ?? []).filter((w) => w.status === 'active')}
            when={(s) => formatInstant(s.startsAt, project.timezone)}
            siteName={siteName}
            m={m}
          />
          <NewShift
            timezone={project.timezone}
            defaultDate={startDate}
            sites={(sites.data ?? []).filter((s) => s.active)}
            m={m}
          />
        </>
      ) : null}
    </div>
  );
}

type Mutations = ReturnType<typeof useRosterMutations>;

function AssignPanel({
  shifts,
  workers,
  when,
  siteName,
  m,
}: {
  shifts: Shift[];
  workers: { id: string; fullName: string }[];
  when: (s: Shift) => string;
  siteName: (id: string) => string;
  m: Mutations;
}) {
  const [shiftId, setShiftId] = useState('');
  const [workerId, setWorkerId] = useState('');
  if (shifts.length === 0) return null;
  function save(e: FormEvent) {
    e.preventDefault();
    if (!shiftId || !workerId) return;
    m.assign.mutate({ shiftId, workerIds: [workerId] }, { onSuccess: () => setWorkerId('') });
  }
  return (
    <Card title="Put a worker on a shift">
      <form className="stack-lg" onSubmit={save} noValidate>
        <div className="form-row">
          <Select
            label="Shift"
            value={shiftId}
            onChange={(e) => setShiftId(e.target.value)}
            options={[
              { value: '', label: 'Choose a shift' },
              ...shifts.map((s) => ({
                value: s.id,
                label: `${when(s)}, ${siteName(s.siteId)}, ${s.trade}`,
              })),
            ]}
          />
          <Select
            label="Worker"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            options={[
              { value: '', label: 'Choose a worker' },
              ...workers.map((w) => ({ value: w.id, label: w.fullName })),
            ]}
          />
        </div>
        <ErrorAlert error={m.assign.error} title="We couldn't put that worker on the shift" />
        <div className="row-actions">
          <Button type="submit" disabled={m.assign.isPending || !shiftId || !workerId}>
            {m.assign.isPending ? 'Saving…' : 'Assign worker'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function NewShift({
  timezone,
  defaultDate,
  sites,
  m,
}: {
  timezone: string;
  defaultDate: string;
  sites: { id: string; name: string }[];
  m: Mutations;
}) {
  const [siteId, setSiteId] = useState('');
  const [trade, setTrade] = useState('');
  const [crew, setCrew] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [start, setStart] = useState('07:00');
  const [end, setEnd] = useState('15:30');
  const [headcount, setHeadcount] = useState('1');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const count = Number(headcount);
    if (!siteId) return setError('Choose the site.');
    if (!trade.trim()) return setError('Say which trade the shift is for.');
    if (!Number.isInteger(count) || count < 1 || count > 500)
      return setError('Headcount must be a whole number from 1 to 500.');
    if (!date || !start || !end) return setError('Enter the date, start and finish times.');
    if (end <= start) return setError('The shift must finish after it starts.');
    m.createShift.mutate(
      {
        siteId,
        trade: trade.trim(),
        ...(crew.trim() ? { crew: crew.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        startsAt: zonedToUtc(date, start, timezone).toISOString(),
        endsAt: zonedToUtc(date, end, timezone).toISOString(),
        requiredHeadcount: count,
      },
      {
        onSuccess: () => {
          setTrade('');
          setCrew('');
          setNote('');
        },
      },
    );
  }

  return (
    <Card title="Draft a shift">
      <form className="stack-lg" onSubmit={save} noValidate>
        <Select
          label="Site"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
          options={[
            { value: '', label: 'Choose a site' },
            ...sites.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <div className="form-row">
          <TextField
            label="Trade"
            required
            value={trade}
            onChange={(e) => setTrade(e.target.value)}
          />
          <TextField label="Crew" value={crew} onChange={(e) => setCrew(e.target.value)} />
        </div>
        <div className="form-row">
          <TextField
            label="Date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <TextField
            label="Start"
            type="time"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
          <TextField
            label="Finish"
            type="time"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
          <TextField
            label="Workers needed"
            inputMode="numeric"
            required
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
          />
        </div>
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ErrorAlert error={m.createShift.error} title="We couldn't save this shift" />
        <div className="row-actions">
          <Button type="submit" disabled={m.createShift.isPending}>
            {m.createShift.isPending ? 'Saving…' : 'Draft shift'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
