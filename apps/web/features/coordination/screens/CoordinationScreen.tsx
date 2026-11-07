'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Card,
  DataTable,
  Dialog,
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
import { CoordinationIcon, Plus } from '@archova/ui/icons';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate, todayIn } from '@/shared/lib/format';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { CoordinationDashboard } from '../components/CoordinationDashboard';
import { CreateIssueDialog } from '../components/CreateIssueDialog';
import type {
  BimDiscipline,
  BimModel,
  CoordinationIssue,
  CoordinationIssuePriority,
  CoordinationIssueStatus,
} from '../data/api';
import {
  useBimModels,
  useCoordinationIssues,
  useCoordinationMutations,
} from '../hooks/useCoordination';
import {
  DISCIPLINE_LABEL,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  STATUS_LABEL,
  isActive,
  issueLabel,
  priorityTone,
  statusTone,
} from '../lib/issues';
import { CoordinationIssueDetailView } from './CoordinationIssueDetailView';

const STATUSES = Object.keys(STATUS_LABEL) as CoordinationIssueStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as CoordinationIssuePriority[];
const DISCIPLINES = Object.keys(DISCIPLINE_LABEL) as BimDiscipline[];
const GROUPS = { status: 'Status', priority: 'Priority', assignee: 'Assigned to' } as const;
type GroupBy = keyof typeof GROUPS;

/** Design coordination: the clashes and gaps found in the models and drawings, and the models they were found in. */
export function CoordinationScreen() {
  const [params] = useUrlState(['issue'] as const);
  return params.issue ? (
    <CoordinationIssueDetailView id={params.issue} />
  ) : (
    <CoordinationRegister />
  );
}

function CoordinationRegister() {
  const dir = useProjectDirectory();
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const [params, setParams] = useUrlState([
    'issue',
    'status',
    'priority',
    'assignee',
    'group',
    'q',
  ] as const);
  const issues = useCoordinationIssues({});
  const models = useBimModels();
  const m = useCoordinationMutations();
  const [raising, setRaising] = useState(false);

  const [registering, setRegistering] = useState(false);
  const [modelName, setModelName] = useState('');
  const [discipline, setDiscipline] = useState<BimDiscipline>('architectural');
  const [versionLabel, setVersionLabel] = useState('');
  const [replaces, setReplaces] = useState('');
  const [modelFile, setModelFile] = useState<File | null>(null);

  const status = (STATUSES as string[]).includes(params.status)
    ? (params.status as CoordinationIssueStatus)
    : undefined;
  const priority = (PRIORITIES as string[]).includes(params.priority)
    ? (params.priority as CoordinationIssuePriority)
    : undefined;
  const group = (Object.keys(GROUPS) as string[]).includes(params.group)
    ? (params.group as GroupBy)
    : undefined;
  const search = params.q.trim().toLowerCase();
  const all = issues.data ?? [];
  const today = todayIn(project.timezone);
  const shown = all.filter(
    (i) =>
      (!status || i.status === status) &&
      (!priority || i.priority === priority) &&
      (!params.assignee ||
        (params.assignee === 'none' ? i.assigneeId === null : i.assigneeId === params.assignee)) &&
      (!search ||
        `${issueLabel(i.number)} ${i.title} ${i.location}`.toLowerCase().includes(search)),
  );
  const filtered = Boolean(status || priority || params.assignee || search);

  const modelName_ = (id: string | null) =>
    id ? ((models.data ?? []).find((x) => x.id === id)?.name ?? '—') : '—';
  const currentModels = (models.data ?? []).filter((x) => x.status === 'current');

  const issueColumns: DataTableColumn<CoordinationIssue>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (i) => i.number,
      cell: (i) => issueLabel(i.number),
    },
    {
      id: 'title',
      header: 'Issue',
      sortValue: (i) => i.title,
      cell: (i) => (
        <Link
          className="link"
          href={`${webRoutes.coordination(org.orgSlug, project.projectId)}?issue=${encodeURIComponent(i.id)}`}
          aria-label={`Open ${issueLabel(i.number)} ${i.title}`}
        >
          {i.title}
        </Link>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => STATUSES.indexOf(i.status),
      cell: (i) => <StatusPill tone={statusTone(i.status)}>{STATUS_LABEL[i.status]}</StatusPill>,
    },
    {
      id: 'priority',
      header: 'Priority',
      sortValue: (i) => PRIORITY_ORDER.indexOf(i.priority),
      cell: (i) => (
        <StatusPill tone={priorityTone(i.priority)}>{PRIORITY_LABEL[i.priority]}</StatusPill>
      ),
    },
    {
      id: 'assignee',
      header: 'Ball in court',
      sortValue: (i) => (i.assigneeId ? dir.personName(i.assigneeId) : null),
      cell: (i) => (i.assigneeId ? dir.personName(i.assigneeId) : '—'),
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (i) => i.dueDate ?? '9999',
      cell: (i) =>
        i.dueDate ? (
          isActive(i.status) && i.dueDate < today ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(i.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(i.dueDate)
          )
        ) : (
          '—'
        ),
    },
    { id: 'model', header: 'Model', cell: (i) => modelName_(i.modelId) },
  ];
  const modelColumns: DataTableColumn<BimModel>[] = [
    { id: 'name', header: 'Model', rowHeader: true, cell: (x) => x.name },
    { id: 'discipline', header: 'Discipline', cell: (x) => DISCIPLINE_LABEL[x.discipline] },
    {
      id: 'version',
      header: 'Version',
      cell: (x) => `${x.versionLabel || '—'}${x.fileId ? '' : ' · no IFC file'}`,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (x) => (
        <StatusPill tone={x.status === 'current' ? 'success' : 'neutral'}>
          {x.status === 'current' ? 'Current' : 'Superseded'}
        </StatusPill>
      ),
    },
  ];

  const groupBy =
    group === undefined
      ? undefined
      : {
          key: (i: CoordinationIssue) =>
            group === 'status'
              ? i.status
              : group === 'priority'
                ? i.priority
                : (i.assigneeId ?? ''),
          label: (key: string, rows: readonly CoordinationIssue[]) =>
            `${
              group === 'status'
                ? STATUS_LABEL[key as CoordinationIssueStatus]
                : group === 'priority'
                  ? PRIORITY_LABEL[key as CoordinationIssuePriority]
                  : key
                    ? dir.personName(key)
                    : 'Not assigned'
            } · ${rows.length}`,
          order: group === 'status' ? STATUSES : group === 'priority' ? PRIORITY_ORDER : undefined,
        };

  return (
    <>
      <PageHeader
        eyebrow="Coordination"
        title="Coordination issues"
        description="Clashes and gaps found in the models and on the drawings. Assign each one, track who it is waiting on, and link the RFI that resolves it."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.coordinationModels(org.orgSlug, project.projectId)}
            >
              <CoordinationIcon size={16} aria-hidden="true" /> Open 3D viewer
            </Link>
            <Button onClick={() => setRaising(true)}>
              <Plus size={16} aria-hidden="true" /> Raise an issue
            </Button>
          </>
        }
      />
      <div className="stack-lg">
        <ErrorAlert error={issues.error} title="We couldn't load the coordination issues" />
        {issues.isPending ? (
          <SkeletonRows label="Loading coordination issues…" />
        ) : all.length === 0 ? (
          <EmptyState
            icon={CoordinationIcon}
            title="No coordination issues"
            description="Raise one when you find a clash or a gap in a model or on a drawing."
          />
        ) : (
          <>
            <CoordinationDashboard issues={all} />
            <FilterBar label="Filter coordination issues">
              <TextField
                label="Search"
                type="search"
                value={params.q}
                placeholder="Number, title or location"
                onChange={(e) => setParams({ q: e.target.value })}
              />
              <Select
                label="Status"
                value={params.status}
                placeholder="Any status"
                options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                onChange={(e) => setParams({ status: e.target.value })}
              />
              <Select
                label="Priority"
                value={params.priority}
                placeholder="Any priority"
                options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
                onChange={(e) => setParams({ priority: e.target.value })}
              />
              <Select
                label="Ball in court"
                value={params.assignee}
                placeholder="Anyone"
                options={[
                  { value: 'none', label: 'Not assigned' },
                  ...dir.people.map((p) => ({ value: p.id, label: p.name })),
                ]}
                onChange={(e) => setParams({ assignee: e.target.value })}
              />
              <Select
                label="Group by"
                value={params.group}
                placeholder="No grouping"
                options={(Object.keys(GROUPS) as GroupBy[]).map((g) => ({
                  value: g,
                  label: GROUPS[g],
                }))}
                onChange={(e) => setParams({ group: e.target.value })}
              />
            </FilterBar>
            {shown.length === 0 ? (
              <EmptyState
                icon={CoordinationIcon}
                title="No issues match"
                description={filtered ? 'Try a different filter.' : 'Nothing here yet.'}
              />
            ) : (
              <DataTable
                caption="Coordination issues"
                columns={issueColumns}
                rows={shown}
                getRowId={(i) => i.id}
                {...(groupBy ? { groupBy } : {})}
              />
            )}
          </>
        )}
        <Card
          title="Models"
          actions={
            <Button
              variant="secondary"
              onClick={() => {
                m.registerModel.reset();
                setModelName('');
                setDiscipline('architectural');
                setVersionLabel('');
                setReplaces('');
                setModelFile(null);
                setRegistering(true);
              }}
            >
              <Plus size={16} aria-hidden="true" /> Register a model
            </Button>
          }
        >
          <ErrorAlert error={models.error} title="We couldn't load the models" />
          {models.isPending ? (
            <SkeletonRows label="Loading models…" />
          ) : (models.data ?? []).length === 0 ? (
            <p className="u-muted u-m-0">
              No models registered yet. Register an IFC model to pin issues to it and open it in 3D.
            </p>
          ) : (
            <DataTable
              caption="Models"
              columns={modelColumns}
              rows={models.data ?? []}
              getRowId={(x) => x.id}
            />
          )}
        </Card>
      </div>

      <CreateIssueDialog
        open={raising}
        onClose={() => setRaising(false)}
        onCreated={(x) => setParams({ issue: x.issue.id })}
      />

      <Dialog
        open={registering}
        onClose={() => setRegistering(false)}
        title="Register a model"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRegistering(false)}>
              Cancel
            </Button>
            <Button
              disabled={!modelName.trim() || m.registerModel.isPending}
              onClick={() =>
                m.registerModel.mutate(
                  {
                    name: modelName.trim(),
                    discipline,
                    ...(versionLabel.trim() ? { versionLabel: versionLabel.trim() } : {}),
                    ...(replaces ? { supersedesModelId: replaces } : {}),
                    ...(modelFile ? { file: modelFile } : {}),
                  },
                  { onSuccess: () => setRegistering(false) },
                )
              }
            >
              {m.registerModel.isPending
                ? modelFile
                  ? 'Uploading…'
                  : 'Registering…'
                : 'Register model'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField
            label="Name"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
          />
          <Select
            label="Discipline"
            value={discipline}
            options={DISCIPLINES.map((x) => ({ value: x, label: DISCIPLINE_LABEL[x] }))}
            onChange={(e) => setDiscipline(e.target.value as BimDiscipline)}
          />
          <TextField
            label="Version"
            placeholder="Rev B"
            value={versionLabel}
            onChange={(e) => setVersionLabel(e.target.value)}
          />
          <div className="ac-field">
            <label className="ac-field__label" htmlFor="model-file">
              IFC file (optional)
            </label>
            <input
              id="model-file"
              className="file-input"
              type="file"
              accept=".ifc"
              onChange={(e) => setModelFile(e.target.files?.[0] ?? null)}
            />
            <span className="ac-field__hint">Needed to open the model in the 3D viewer.</span>
          </div>
          {currentModels.length > 0 ? (
            <Select
              label="Replaces"
              value={replaces}
              options={[
                { value: '', label: 'Nothing, this is a new model' },
                ...currentModels.map((x) => ({ value: x.id, label: x.name })),
              ]}
              onChange={(e) => setReplaces(e.target.value)}
            />
          ) : null}
          <ErrorAlert error={m.registerModel.error} title="We couldn't register the model" />
        </div>
      </Dialog>
    </>
  );
}
