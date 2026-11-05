'use client';

import Link from 'next/link';
import {
  Button,
  Checkbox,
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
} from '@archova/ui';
import { CorrespondenceIcon, Plus } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useProjectPermissions } from '@/features/projects';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { CorrespondenceStatusPill, TimeBar } from '../components/CorrespondenceChips';
import { TypeSetup } from '../components/TypeSetup';
import { useCorrespondenceList, useProjectTypes } from '../hooks/useCorrespondence';
import {
  CORRESPONDENCE_STATUSES,
  STATUS_LABELS,
  type CorrespondenceItem,
  type CorrespondenceStatus,
} from '../lib/types';

/** The correspondence register: notices, site instructions and letters, with the time-bar chip on drafts. */
export function CorrespondenceListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const perms = useProjectPermissions(org.orgId, project.projectId);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'correspondence', id: 'register' },
  });
  const [params, setParams] = useUrlState(['status', 'type', 'waiting', 'q'] as const);
  const status = (CORRESPONDENCE_STATUSES as readonly string[]).includes(params.status)
    ? (params.status as CorrespondenceStatus)
    : undefined;
  const types = useProjectTypes(project.projectId);
  const list = useCorrespondenceList(project.projectId, {
    status,
    typeId: params.type || undefined,
    awaitingResponse: params.waiting ? true : undefined,
    q: params.q || undefined,
  });
  const filtered = Boolean(params.status || params.type || params.waiting || params.q);
  const isAdmin = perms.data?.orgRole === 'owner' || perms.data?.orgRole === 'admin';

  const columns: DataTableColumn<CorrespondenceItem>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (r) => r.numberLabel,
      cell: (r) => (
        <Link
          className="link u-mono"
          href={webRoutes.correspondenceItem(org.orgSlug, project.projectId, r.id)}
        >
          {r.numberLabel}
        </Link>
      ),
    },
    {
      id: 'subject',
      header: 'Subject',
      sortValue: (r) => r.subject,
      cell: (r) => r.subject || '—',
    },
    { id: 'type', header: 'Type', sortValue: (r) => r.typeName, cell: (r) => r.typeName },
    {
      id: 'to',
      header: 'To',
      cell: (r) =>
        r.toCompanyIds.length ? (
          r.toCompanyIds.map((c) => dir.companyName(c)).join(', ')
        ) : (
          <span className="u-muted">—</span>
        ),
    },
    {
      id: 'sent',
      header: 'Sent',
      sortValue: (r) => r.sentAt ?? '9999',
      cell: (r) =>
        r.sentAt ? formatLocalDate(r.sentAt.slice(0, 10)) : <span className="u-muted">—</span>,
    },
    {
      id: 'timebar',
      header: 'Notice by',
      sortValue: (r) => r.timeBarDate ?? '9999',
      cell: (r) => <TimeBar item={r} />,
    },
    {
      id: 'due',
      header: 'Response due',
      sortValue: (r) => r.dueDate ?? '9999',
      cell: (r) =>
        r.dueDate && r.responseRequired ? (
          formatLocalDate(r.dueDate)
        ) : (
          <span className="u-muted">—</span>
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => CORRESPONDENCE_STATUSES.indexOf(r.status),
      cell: (r) => (
        <>
          <CorrespondenceStatusPill status={r.status} />
          {r.isEvidential && r.status !== 'draft' ? (
            <StatusPill tone="neutral">Evidence</StatusPill>
          ) : null}
        </>
      ),
    },
  ];

  const hasTypes = (types.data?.length ?? 0) > 0;
  return (
    <div className="stack-lg">
      <PageHeader
        title="Correspondence"
        description="Notices, site instructions and letters, kept as a record of what was sent, to whom and when."
        actions={
          hasTypes ? (
            <Link
              className={buttonClassName('primary')}
              href={webRoutes.newCorrespondence(org.orgSlug, project.projectId)}
            >
              <Plus size={16} aria-hidden="true" /> New
            </Link>
          ) : (
            <Button disabled>New</Button>
          )
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Correspondence" /> : null}
      <FilterBar label="Filter correspondence">
        <TextField
          label="Search"
          type="search"
          value={params.q}
          onChange={(e) => setParams({ q: e.target.value })}
          placeholder="Number or subject"
        />
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={CORRESPONDENCE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Type"
          value={params.type}
          placeholder="Any type"
          options={(types.data ?? []).map((t) => ({ value: t.id, label: t.name }))}
          onChange={(e) => setParams({ type: e.target.value })}
        />
        <Checkbox
          label="Waiting for a response"
          checked={Boolean(params.waiting)}
          onChange={(e) => setParams({ waiting: e.target.checked ? '1' : null })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load correspondence" />
      {list.isPending ? (
        <SkeletonRows label="Loading correspondence…" />
      ) : (
        <DataTable
          caption="Correspondence register"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'number', direction: 'asc' }}
          rowClassName={(r) =>
            r.status === 'closed' || r.status === 'void' ? 'row--muted' : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                icon={CorrespondenceIcon}
                title="Nothing matches these filters"
                description="Clear a filter to see more."
              />
            ) : (
              <EmptyState
                icon={CorrespondenceIcon}
                title="No correspondence yet"
                description={
                  hasTypes
                    ? 'Start a notice from one of the types set up for your company.'
                    : 'An admin sets up the notice types first, starting from the Australian templates.'
                }
              />
            )
          }
        />
      )}
      {isAdmin ? <TypeSetup /> : null}
    </div>
  );
}
