'use client';

import Link from 'next/link';
import {
  Checkbox,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { Plus, RfisIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { isOverdue } from '../lib/lifecycle';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import {
  ImpactChip,
  RfiDue,
  RfiStatusPill,
  StaleBallFlag,
  ballInCourtLabel,
  ballWaitingDays,
} from '../components/RfiChips';
import { useRfiList } from '../hooks/useRfis';
import {
  RFI_STATUSES,
  STALE_BALL_BUSINESS_DAYS,
  STATUS_LABELS,
  formatRfiNumber,
  type Rfi,
  type RfiStatus,
} from '../lib/types';

/** The RFI register (RFI-US7): filter by ball in court, overdue and impact, all kept in the URL. */
export function RfiListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const dir = useProjectDirectory();
  const everyRfi = useRfiList(project.projectId, {});
  const today = todayIn(project.timezone);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'rfis', id: 'register' },
    ...(everyRfi.data
      ? {
          counts: {
            open: everyRfi.data.filter((r) => r.status === 'open').length,
            overdue: everyRfi.data.filter((r) => isOverdue(r, today)).length,
          },
        }
      : {}),
  });
  const [params, setParams] = useUrlState([
    'status',
    'waiting',
    'stale',
    'overdue',
    'impact',
    'q',
  ] as const);
  const status = (RFI_STATUSES as readonly string[]).includes(params.status)
    ? (params.status as RfiStatus)
    : undefined;
  const list = useRfiList(project.projectId, {
    status,
    ballInCourtCompanyId: params.waiting || undefined,
    overdueBefore: params.overdue ? today : undefined,
    impact: params.impact ? 'yes' : undefined,
    q: params.q || undefined,
  });
  const waited = (r: Rfi) => ballWaitingDays(r, today, project.timezone);
  const rows = (list.data ?? []).filter(
    (r) => !params.stale || (waited(r) ?? 0) >= STALE_BALL_BUSINESS_DAYS,
  );
  const filtered = Boolean(
    params.status || params.waiting || params.stale || params.overdue || params.impact || params.q,
  );

  const columns: DataTableColumn<Rfi>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (r) => r.number ?? Number.MAX_SAFE_INTEGER,
      cell: (r) => (
        <Link className="link u-mono" href={webRoutes.rfi(org.orgSlug, project.projectId, r.id)}>
          {formatRfiNumber(r.number)}
        </Link>
      ),
    },
    { id: 'subject', header: 'Subject', sortValue: (r) => r.subject, cell: (r) => r.subject },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => RFI_STATUSES.indexOf(r.status),
      cell: (r) => <RfiStatusPill status={r.status} />,
    },
    {
      id: 'contractor',
      header: 'Responsible contractor',
      sortValue: (r) => (r.assigneeCompanyId ? dir.companyName(r.assigneeCompanyId) : ''),
      cell: (r) =>
        r.assigneeCompanyId ? (
          dir.companyName(r.assigneeCompanyId)
        ) : (
          <span className="u-muted">—</span>
        ),
    },
    {
      id: 'receivedFrom',
      header: 'Received from',
      sortValue: (r) => (r.receivedFromCompanyId ? dir.companyName(r.receivedFromCompanyId) : ''),
      cell: (r) =>
        r.receivedFromCompanyId ? (
          dir.companyName(r.receivedFromCompanyId)
        ) : (
          <span className="u-muted">—</span>
        ),
    },
    {
      id: 'initiated',
      header: 'Date initiated',
      sortValue: (r) => r.createdAt,
      cell: (r) => formatLocalDate(todayIn(project.timezone, new Date(r.createdAt))),
    },
    {
      id: 'manager',
      header: 'RFI manager',
      sortValue: (r) => dir.personName(r.managerId),
      cell: (r) => dir.personName(r.managerId),
    },
    {
      id: 'assignee',
      header: 'Assignee',
      sortValue: (r) => (r.assigneeId ? dir.personName(r.assigneeId) : ''),
      cell: (r) =>
        r.assigneeId ? dir.personName(r.assigneeId) : <span className="u-muted">—</span>,
    },
    {
      id: 'waiting',
      header: 'Ball in court',
      // Longest wait first when sorted descending; RFIs nobody holds sort as no wait.
      sortValue: (r) => waited(r) ?? -1,
      cell: (r) => (
        <span className="stack-sm">
          {ballInCourtLabel(r, actor, dir) ?? <span className="u-muted">—</span>}
          <StaleBallFlag days={waited(r)} />
        </span>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (r) => r.dueDate ?? '9999',
      cell: (r) => <RfiDue rfi={r} today={today} />,
    },
    { id: 'impact', header: 'Impact', cell: (r) => <ImpactChip rfi={r} /> },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="RFIs"
        description="Questions to consultants and the superintendent, with who holds the ball and when it's due."
        actions={
          <Link
            className={buttonClassName('primary')}
            href={webRoutes.newRfi(org.orgSlug, project.projectId)}
          >
            <Plus size={16} aria-hidden="true" /> New RFI
          </Link>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="RFIs" /> : null}
      <FilterBar label="Filter RFIs">
        <TextField
          label="Search"
          type="search"
          value={params.q}
          onChange={(e) => setParams({ q: e.target.value })}
          placeholder="Number, subject or question"
        />
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={RFI_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Waiting on"
          value={params.waiting}
          placeholder="Anyone"
          options={dir.companies.map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setParams({ waiting: e.target.value })}
        />
        <Checkbox
          label={`Ball held ${STALE_BALL_BUSINESS_DAYS}+ days`}
          checked={Boolean(params.stale)}
          onChange={(e) => setParams({ stale: e.target.checked ? '1' : null })}
        />
        <Checkbox
          label="Overdue only"
          checked={Boolean(params.overdue)}
          onChange={(e) => setParams({ overdue: e.target.checked ? '1' : null })}
        />
        <Checkbox
          label="Cost impact"
          checked={Boolean(params.impact)}
          onChange={(e) => setParams({ impact: e.target.checked ? '1' : null })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load RFIs" />
      {list.isPending ? (
        <SkeletonRows label="Loading RFIs…" />
      ) : (
        <DataTable
          caption="RFIs"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'number', direction: 'desc' }}
          rowClassName={(r) => (r.status === 'void' ? 'row--muted' : undefined)}
          empty={
            filtered ? (
              <EmptyState
                icon={RfisIcon}
                title="No RFIs match these filters"
                description="Clear a filter to see more."
              />
            ) : (
              <EmptyState
                icon={RfisIcon}
                title="No RFIs yet"
                description="Raise one when the drawings or specification leave a question open."
              />
            )
          }
        />
      )}
    </div>
  );
}
