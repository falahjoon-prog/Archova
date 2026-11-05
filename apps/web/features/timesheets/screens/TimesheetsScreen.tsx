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
import { useWorkers } from '@/features/attendance';
import { useCostCodes } from '@/features/budget';
import { useProjectPermissions } from '@/features/projects';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import type { Timesheet, TimesheetLine, TimesheetStatus } from '../data/api';
import { useTimesheetMutations, useTimesheets } from '../hooks/useTimesheets';

const STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  exported: 'Exported',
};
const TONE = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  exported: 'info',
} as const;
const SOURCE_LABELS = { attendance: 'Sign-in', manual: 'Added', adjusted: 'Adjusted' } as const;
const editable = (s: TimesheetStatus) => s === 'draft' || s === 'rejected';
const WHOLE = /^\d{1,4}$/;

type Mutations = ReturnType<typeof useTimesheetMutations>;

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Daily timesheets built from sign-ins (ATT-US9). Crews fix their hours with a reason and submit; a supervisor
 * approves or sends them back, and approved sheets export as CSV for payroll. Approved sheets are locked.
 */
export function TimesheetsScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'timesheets', id: 'register' },
  });
  const isAdmin =
    perms.data?.orgRole === 'owner' ||
    perms.data?.orgRole === 'admin' ||
    atLeast(perms.data?.toolLevels.workforce, 'admin');
  const today = todayIn(project.timezone);
  const [to, setTo] = useState(today);
  const [from, setFrom] = useState(addDays(today, -6));
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useTimesheets(project.projectId, from, to);
  const m = useTimesheetMutations(project.projectId);
  const workers = useWorkers({});
  const workerName = (id: string) => workers.data?.find((w) => w.id === id)?.fullName ?? 'Worker';
  const open = q.data?.find((t) => t.id === openId) ?? null;
  const rangeOk = from <= to;

  const columns: DataTableColumn<Timesheet>[] = [
    {
      id: 'date',
      header: 'Day',
      rowHeader: true,
      sortValue: (t) => t.date,
      cell: (t) => formatLocalDate(t.date),
    },
    {
      id: 'worker',
      header: 'Worker',
      cell: (t) => workerName(t.workerId),
    },
    {
      id: 'hours',
      header: 'Paid hours',
      align: 'end',
      sortValue: (t) => t.paidMinutes,
      cell: (t) => <span className="u-mono">{t.paidHours}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => <StatusPill tone={TONE[t.status]}>{STATUS_LABELS[t.status]}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (t) => (
        <span className="row-actions">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setOpenId(t.id === openId ? null : t.id)}
          >
            {t.id === openId ? 'Close' : 'Open'} {formatLocalDate(t.date)}
          </Button>
          {editable(t.status) ? (
            <Button
              size="sm"
              disabled={m.submit.isPending || t.lines.length === 0}
              onClick={() => m.submit.mutate(t.id)}
            >
              Submit {formatLocalDate(t.date)}
            </Button>
          ) : null}
          {isAdmin && t.status === 'submitted' ? (
            <Button size="sm" disabled={m.approve.isPending} onClick={() => m.approve.mutate(t.id)}>
              Approve {formatLocalDate(t.date)}
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  if (perms.isPending) return <SkeletonRows label="Loading timesheets…" />;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Timesheets"
        description="Hours built from sign-ins. Fix them with a reason, submit, and a supervisor approves. Approved timesheets are locked."
      />
      <div className="form-row">
        <TextField
          label="From"
          type="date"
          value={from}
          onChange={(e) => e.target.value && setFrom(e.target.value)}
        />
        <TextField
          label="To"
          type="date"
          value={to}
          onChange={(e) => e.target.value && setTo(e.target.value)}
        />
      </div>
      {!rangeOk ? <Alert tone="danger">The range must not end before it starts.</Alert> : null}
      <div className="row-actions">
        <Button
          variant="secondary"
          disabled={!rangeOk || m.generate.isPending}
          onClick={() => m.generate.mutate({ from, to })}
        >
          {m.generate.isPending ? 'Building…' : 'Build from sign-ins'}
        </Button>
        {isAdmin ? (
          <Button
            disabled={!rangeOk || m.exportCsv.isPending}
            onClick={() =>
              m.exportCsv.mutate(
                { from, to },
                { onSuccess: (x) => x.count > 0 && download(x.filename, x.csv) },
              )
            }
          >
            Export approved as CSV
          </Button>
        ) : null}
      </div>
      {m.generate.isSuccess ? (
        <Alert tone="success">
          {m.generate.data.sheetsCreated} new timesheet
          {m.generate.data.sheetsCreated === 1 ? '' : 's'}, {m.generate.data.linesAdded} line
          {m.generate.data.linesAdded === 1 ? '' : 's'} added from sign-ins.
        </Alert>
      ) : null}
      {m.exportCsv.isSuccess && m.exportCsv.data.count === 0 ? (
        <Alert tone="info">Nothing approved in this range is waiting to be exported.</Alert>
      ) : null}
      <ErrorAlert
        error={
          m.generate.error ??
          m.exportCsv.error ??
          m.submit.error ??
          m.approve.error ??
          m.reject.error
        }
        title="We couldn't complete that"
      />
      {q.isPending ? (
        <SkeletonRows label="Loading timesheets…" />
      ) : q.isError ? (
        <ErrorAlert error={q.error} title="We couldn't load timesheets" />
      ) : (
        <DataTable
          caption="Timesheets"
          columns={columns}
          rows={q.data}
          getRowId={(t) => t.id}
          empty={
            <EmptyState
              title="No timesheets in this range"
              description="Build them from sign-ins once people have signed out."
            />
          }
        />
      )}
      {open ? (
        <SheetDetail sheet={open} isAdmin={isAdmin} projectId={project.projectId} m={m} />
      ) : null}
    </div>
  );
}

function SheetDetail({
  sheet,
  isAdmin,
  projectId,
  m,
}: {
  sheet: Timesheet;
  isAdmin: boolean;
  projectId: string;
  m: Mutations;
}) {
  const costCodes = (useCostCodes(projectId).data ?? []).filter((c) => !c.archived);
  const canEdit = editable(sheet.status);
  const [lineId, setLineId] = useState('');
  const [minutes, setMinutes] = useState('');
  const [breakMinutes, setBreakMinutes] = useState('');
  const [costCodeId, setCostCodeId] = useState('');
  const [reason, setReason] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const label = (l: TimesheetLine) =>
    `${SOURCE_LABELS[l.source]}: ${l.minutes} min, ${l.breakMinutes} min break`;
  const columns: DataTableColumn<TimesheetLine>[] = [
    { id: 'src', header: 'Line', rowHeader: true, cell: (l) => SOURCE_LABELS[l.source] },
    {
      id: 'min',
      header: 'Minutes',
      align: 'end',
      cell: (l) => <span className="u-mono">{l.minutes}</span>,
    },
    {
      id: 'brk',
      header: 'Break',
      align: 'end',
      cell: (l) => <span className="u-mono">{l.breakMinutes}</span>,
    },
    {
      id: 'code',
      header: 'Cost code',
      cell: (l) => {
        const c = costCodes.find((x) => x.id === l.costCodeId);
        return c ? c.code : '—';
      },
    },
    { id: 'why', header: 'Reason', cell: (l) => l.adjustedReason ?? '—' },
  ];

  function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!reason.trim()) return setError('Give a reason for the change.');
    if (minutes && !WHOLE.test(minutes)) return setError('Minutes must be a whole number.');
    if (breakMinutes && !WHOLE.test(breakMinutes))
      return setError('Break must be a whole number of minutes.');
    const min = minutes ? Number(minutes) : undefined;
    const brk = breakMinutes ? Number(breakMinutes) : undefined;
    if (min !== undefined && min > 1440) return setError('A line can’t be longer than a day.');
    if (min !== undefined && brk !== undefined && brk > min)
      return setError('The break can’t be longer than the time worked.');
    const done = {
      onSuccess: () => {
        setMinutes('');
        setBreakMinutes('');
        setReason('');
      },
    };
    if (lineId)
      m.adjustLine.mutate(
        {
          id: sheet.id,
          lineId,
          body: {
            reason: reason.trim(),
            ...(min !== undefined ? { minutes: min } : {}),
            ...(brk !== undefined ? { breakMinutes: brk } : {}),
            ...(costCodeId ? { costCodeId } : {}),
          },
        },
        done,
      );
    else {
      if (min === undefined) return setError('Enter the minutes worked.');
      m.addLine.mutate(
        {
          id: sheet.id,
          body: {
            minutes: min,
            reason: reason.trim(),
            ...(brk !== undefined ? { breakMinutes: brk } : {}),
            ...(costCodeId ? { costCodeId } : {}),
          },
        },
        done,
      );
    }
  }

  return (
    <Card title={`Timesheet for ${formatLocalDate(sheet.date)}`}>
      <div className="stack-lg">
        {sheet.status === 'rejected' && sheet.rejectionReason ? (
          <Alert tone="warning">Sent back: {sheet.rejectionReason}</Alert>
        ) : null}
        <DataTable
          caption="Lines"
          columns={columns}
          rows={sheet.lines}
          getRowId={(l) => l.id}
          empty={<EmptyState title="No hours yet" description="Add the hours worked below." />}
        />
        {canEdit ? (
          <form className="stack-lg" onSubmit={save} noValidate>
            <Select
              label="Change"
              value={lineId}
              onChange={(e) => setLineId(e.target.value)}
              options={[
                { value: '', label: 'Add a new line' },
                ...sheet.lines.map((l) => ({ value: l.id, label: label(l) })),
              ]}
            />
            <div className="form-row">
              <TextField
                label="Minutes worked"
                inputMode="numeric"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
              <TextField
                label="Break minutes"
                inputMode="numeric"
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(e.target.value)}
              />
            </div>
            {costCodes.length > 0 ? (
              <Select
                label="Cost code"
                value={costCodeId}
                onChange={(e) => setCostCodeId(e.target.value)}
                options={[
                  { value: '', label: 'No change' },
                  ...costCodes.map((c) => ({ value: c.id, label: `${c.code} ${c.description}` })),
                ]}
              />
            ) : null}
            <TextField
              label="Reason"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            {error ? <Alert tone="danger">{error}</Alert> : null}
            <ErrorAlert
              error={m.addLine.error ?? m.adjustLine.error}
              title="We couldn't save that change"
            />
            <div className="row-actions">
              <Button type="submit" disabled={m.addLine.isPending || m.adjustLine.isPending}>
                {lineId ? 'Save change' : 'Add hours'}
              </Button>
            </div>
          </form>
        ) : (
          <Alert tone="info">
            This timesheet is {STATUS_LABELS[sheet.status].toLowerCase()} and can’t be edited.
          </Alert>
        )}
        {isAdmin && sheet.status === 'submitted' ? (
          <div className="stack-lg">
            <TextField
              label="Reason for sending back"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
            <div className="row-actions">
              <Button
                variant="secondary"
                disabled={m.reject.isPending || !rejectReason.trim()}
                onClick={() =>
                  m.reject.mutate(
                    { id: sheet.id, reason: rejectReason.trim() },
                    { onSuccess: () => setRejectReason('') },
                  )
                }
              >
                Send back
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
