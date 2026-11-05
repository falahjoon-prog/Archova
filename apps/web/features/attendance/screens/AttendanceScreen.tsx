'use client';

import Link from 'next/link';
import { webRoutes } from '@archova/routes';
import {
  Alert,
  Badge,
  Card,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  buttonClassName,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { AttendanceIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useAttendanceDay, useOnSite, useRollCalls } from '../hooks/useAttendance';
import {
  KIND_LABELS,
  STATUS_LABELS,
  formatMinutes,
  progressLabel,
  type AttendanceEntry,
  type SessionStatus,
} from '../lib/types';

const STATUS_TONES: Record<SessionStatus, StatusTone> = {
  on_site: 'success',
  off_site: 'neutral',
  auto_closed: 'warning',
  disputed: 'danger',
};

/** `7:05 am` in the project's time zone (conventions §Time). */
function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** Who is on site now and a day's sign-in records (ATT-US2, ATT-AC8). Read-only; sites and gates come later. */
export function AttendanceScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const today = todayIn(project.timezone);
  const [params, setParams] = useUrlState(['date', 'company'] as const);
  const date =
    /^\d{4}-\d{2}-\d{2}$/.test(params.date) && params.date <= today ? params.date : today;
  const onSite = useOnSite();
  const openRoll = useRollCalls().data?.find((r) => !r.endedAt) ?? null;
  const day = useAttendanceDay(date, params.company || undefined);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'attendance', id: 'register' },
  });

  // A company typed at the gate is shown as typed until the site manager confirms it.
  const company = (e: { companyId: string | null; companyNameOther: string | null }) =>
    e.companyId
      ? dir.companyName(e.companyId)
      : e.companyNameOther
        ? `${e.companyNameOther} (unconfirmed)`
        : '—';

  const columns: DataTableColumn<AttendanceEntry>[] = [
    {
      id: 'name',
      header: 'Name',
      rowHeader: true,
      sortValue: (e) => e.workerName,
      cell: (e) => (
        <>
          {e.workerName}
          {e.kind !== 'worker' ? <span className="u-caption"> · {KIND_LABELS[e.kind]}</span> : null}
        </>
      ),
    },
    { id: 'company', header: 'Company', sortValue: company, cell: company },
    {
      id: 'in',
      header: 'Signed in',
      sortValue: (e) => e.signedInAt,
      cell: (e) => clock(e.signedInAt, project.timezone),
    },
    {
      id: 'out',
      header: 'Signed out',
      sortValue: (e) => e.signedOutAt,
      cell: (e) => (e.signedOutAt ? clock(e.signedOutAt, project.timezone) : '—'),
    },
    {
      id: 'hours',
      header: 'Time on site',
      align: 'end',
      sortValue: (e) => e.minutes,
      cell: (e) =>
        e.minutes === null
          ? '—'
          : `${e.status === 'auto_closed' ? 'About ' : ''}${formatMinutes(e.minutes)}`,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (e) => STATUS_LABELS[e.status],
      cell: (e) => <StatusPill tone={STATUS_TONES[e.status]}>{STATUS_LABELS[e.status]}</StatusPill>,
    },
  ];

  const people = onSite.data?.people ?? [];
  const companyOptions = dir.companies
    .filter((c) => dir.onProject(c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  return (
    <>
      <PageHeader
        eyebrow="Workforce"
        title="Attendance"
        description="Who is on site now, and each day’s sign-in records."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendanceRollCall(org.orgSlug, project.projectId)}
            >
              Roll call
            </Link>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendanceWorkers(org.orgSlug, project.projectId)}
            >
              Workers
            </Link>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendanceRoster(org.orgSlug, project.projectId)}
            >
              Roster
            </Link>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.attendanceSites(org.orgSlug, project.projectId)}
            >
              Sites and gates
            </Link>
          </>
        }
      />
      {openRoll ? (
        <Alert tone="danger" title="Roll call in progress">
          {progressLabel(openRoll.counts)}.{' '}
          <Link
            className="link"
            href={webRoutes.attendanceRollCall(org.orgSlug, project.projectId, openRoll.id)}
          >
            Open the roll call
          </Link>
        </Alert>
      ) : null}
      {previewDataOnly ? <PreviewDataNotice tool="Attendance" /> : null}
      <ErrorAlert error={onSite.error ?? day.error} title="Couldn’t load attendance" />
      <Card title={`On site now${onSite.data ? ` (${onSite.data.total})` : ''}`}>
        {onSite.isPending ? (
          <SkeletonRows label="Loading who is on site…" />
        ) : onSite.data && onSite.data.total > 0 ? (
          <>
            <ul
              className="row-actions"
              style={{ padding: 0, listStyle: 'none' }}
              aria-label="On site by company"
            >
              {onSite.data.companies.map((c) => (
                <li key={c.companyId ?? c.companyNameOther} className="row-actions">
                  <span>{company(c)}</span>
                  <Badge label={`${c.count} on site`}>{c.count}</Badge>
                </li>
              ))}
            </ul>
            <DataTable
              caption="People on site now"
              columns={columns.filter((c) => ['name', 'company', 'in'].includes(c.id))}
              rows={people}
              getRowId={(e) => e.id}
              defaultSort={{ columnId: 'in', direction: 'desc' }}
            />
          </>
        ) : (
          <EmptyState
            icon={AttendanceIcon}
            title="Nobody is signed in"
            description="People appear here when they sign in at the gate."
          />
        )}
      </Card>
      <Card title="Sign-in records">
        <FilterBar label="Filter sign-in records">
          <TextField
            label="Day"
            type="date"
            max={today}
            value={date}
            onChange={(e) => setParams({ date: e.target.value === today ? '' : e.target.value })}
          />
          <Select
            label="Company"
            value={params.company}
            placeholder="All companies"
            options={companyOptions}
            onChange={(e) => setParams({ company: e.target.value })}
          />
        </FilterBar>
        {day.isPending ? (
          <SkeletonRows label="Loading sign-in records…" />
        ) : (
          <DataTable
            caption={`Sign-in records for ${formatLocalDate(date)}`}
            columns={columns}
            rows={day.data ?? []}
            getRowId={(e) => e.id}
            defaultSort={{ columnId: 'in', direction: 'asc' }}
            empty={
              <EmptyState
                icon={AttendanceIcon}
                title="No sign-ins"
                description={`Nobody signed in on ${formatLocalDate(date)}.`}
              />
            }
          />
        )}
      </Card>
    </>
  );
}
