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
  TextField,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { Plus, SubmittalsIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActor } from '@/shared/providers/useActor';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { SubmitBy, SubmittalStatusPill, ballLabel } from '../components/SubmittalChips';
import { useSubmittalList } from '../hooks/useSubmittals';
import {
  STATUS_LABELS,
  SUBMITTAL_STATUSES,
  SUBMITTAL_TYPES,
  TYPE_LABELS,
  registerCsv,
  type Submittal,
  type SubmittalStatus,
  type SubmittalType,
} from '../lib/types';

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** The submittal register (SUB-US1, US2): required on site, the submit-by date and who has it now. */
export function SubmittalListScreen() {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const actor = useActor();
  const dir = useProjectDirectory();
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'submittals', id: 'register' },
  });
  const [params, setParams] = useUrlState(['status', 'type', 'mine', 'q'] as const);
  const status = (SUBMITTAL_STATUSES as readonly string[]).includes(params.status)
    ? (params.status as SubmittalStatus)
    : undefined;
  const type = (SUBMITTAL_TYPES as readonly string[]).includes(params.type)
    ? (params.type as SubmittalType)
    : undefined;
  const list = useSubmittalList(project.projectId, {
    status,
    type,
    q: params.q || undefined,
    ballInCourt: params.mine ? actor.id : undefined,
  });
  const filtered = Boolean(params.status || params.type || params.mine || params.q);

  const columns: DataTableColumn<Submittal>[] = [
    {
      id: 'number',
      header: 'Number',
      rowHeader: true,
      sortValue: (r) => r.number,
      cell: (r) => (
        <Link
          className="link u-mono"
          href={webRoutes.submittal(org.orgSlug, project.projectId, r.id)}
        >
          {r.numberLabel}
        </Link>
      ),
    },
    { id: 'title', header: 'Title', sortValue: (r) => r.title, cell: (r) => r.title },
    { id: 'type', header: 'Type', sortValue: (r) => r.type, cell: (r) => TYPE_LABELS[r.type] },
    {
      id: 'spec',
      header: 'Spec section',
      sortValue: (r) => r.specSection ?? '',
      cell: (r) => r.specSection ?? <span className="u-muted">—</span>,
    },
    {
      id: 'company',
      header: 'Responsible',
      cell: (r) =>
        r.responsibleCompanyId ? (
          dir.companyName(r.responsibleCompanyId)
        ) : (
          <span className="u-muted">—</span>
        ),
    },
    {
      id: 'onsite',
      header: 'Required on site',
      sortValue: (r) => r.requiredOnSite ?? '9999',
      cell: (r) =>
        r.requiredOnSite ? formatLocalDate(r.requiredOnSite) : <span className="u-muted">—</span>,
    },
    {
      id: 'submitby',
      header: 'Submit by',
      sortValue: (r) => r.submitBy ?? '9999',
      cell: (r) => <SubmitBy item={r} />,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (r) => SUBMITTAL_STATUSES.indexOf(r.status),
      cell: (r) => <SubmittalStatusPill status={r.status} />,
    },
    {
      id: 'ball',
      header: 'Ball in court',
      cell: (r) => ballLabel(r, dir, actor.id) ?? <span className="u-muted">—</span>,
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        title="Shop drawings & submittals"
        description="What has to be approved before it's ordered or installed, by when, and who has it now."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={!list.data?.length}
              onClick={() =>
                download(
                  `submittal-register-${project.projectId}.csv`,
                  registerCsv(list.data ?? [], {
                    company: (id) => dir.companyName(id),
                    person: (id) => dir.personName(id),
                  }),
                )
              }
            >
              Export CSV
            </Button>
            <Link
              className={buttonClassName('primary')}
              href={webRoutes.newSubmittal(org.orgSlug, project.projectId)}
            >
              <Plus size={16} aria-hidden="true" /> Add item
            </Link>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Submittals" /> : null}
      <FilterBar label="Filter submittals">
        <TextField
          label="Search"
          type="search"
          value={params.q}
          onChange={(e) => setParams({ q: e.target.value })}
          placeholder="Number, title or spec section"
        />
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={SUBMITTAL_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Type"
          value={params.type}
          placeholder="Any type"
          options={SUBMITTAL_TYPES.map((s) => ({ value: s, label: TYPE_LABELS[s] }))}
          onChange={(e) => setParams({ type: e.target.value })}
        />
        <Checkbox
          label="Waiting on me"
          checked={Boolean(params.mine)}
          onChange={(e) => setParams({ mine: e.target.checked ? '1' : null })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load submittals" />
      {list.isPending ? (
        <SkeletonRows label="Loading submittals…" />
      ) : (
        <DataTable
          caption="Submittal register"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(r) => r.id}
          defaultSort={{ columnId: 'submitby', direction: 'asc' }}
          rowClassName={(r) => (r.status === 'closed' ? 'row--muted' : undefined)}
          empty={
            filtered ? (
              <EmptyState
                icon={SubmittalsIcon}
                title="No submittals match these filters"
                description="Clear a filter to see more."
              />
            ) : (
              <EmptyState
                icon={SubmittalsIcon}
                title="No submittals yet"
                description="Add the shop drawings, product data and samples the specification asks for, with the date each is needed on site."
              />
            )
          }
        />
      )}
    </div>
  );
}
