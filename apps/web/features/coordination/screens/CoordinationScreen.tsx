'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Card,
  DataTable,
  DescriptionList,
  Dialog,
  EmptyState,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import { CoordinationIcon, Plus } from '@archova/ui/icons';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import type {
  BimDiscipline,
  BimModel,
  CoordinationIssue,
  CoordinationIssuePriority,
  CoordinationIssueStatus,
} from '../data/api';
import {
  useBimModels,
  useCoordinationIssue,
  useCoordinationIssues,
  useCoordinationMutations,
} from '../hooks/useCoordination';
import {
  DISCIPLINE_LABEL,
  PRIORITY_LABEL,
  STATUS_LABEL,
  nextStatuses,
  parseGuids,
  priorityTone,
  statusTone,
} from '../lib/issues';

const STATUSES = Object.keys(STATUS_LABEL) as CoordinationIssueStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABEL) as CoordinationIssuePriority[];
const DISCIPLINES = Object.keys(DISCIPLINE_LABEL) as BimDiscipline[];

/** Design coordination: the clashes and gaps found in the models, and the models they were found in. */
export function CoordinationScreen() {
  const dir = useProjectDirectory();
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const [params, setParams] = useUrlState(['status', 'issue'] as const);
  const status = (STATUSES as string[]).includes(params.status)
    ? (params.status as CoordinationIssueStatus)
    : undefined;
  const issues = useCoordinationIssues({ ...(status ? { status } : {}) });
  const models = useBimModels();
  const selected = params.issue || null;
  const detail = useCoordinationIssue(selected);
  const m = useCoordinationMutations();

  const [raising, setRaising] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CoordinationIssuePriority>('medium');
  const [assignee, setAssignee] = useState('');
  const [modelId, setModelId] = useState('');
  const [location, setLocation] = useState('');
  const [guids, setGuids] = useState('');
  const [comment, setComment] = useState('');

  const [registering, setRegistering] = useState(false);
  const [modelName, setModelName] = useState('');
  const [discipline, setDiscipline] = useState<BimDiscipline>('architectural');
  const [versionLabel, setVersionLabel] = useState('');
  const [replaces, setReplaces] = useState('');
  const [modelFile, setModelFile] = useState<File | null>(null);

  const modelName_ = (id: string | null) =>
    id ? ((models.data ?? []).find((x) => x.id === id)?.name ?? '—') : '—';
  const currentModels = (models.data ?? []).filter((x) => x.status === 'current');

  const issueColumns: DataTableColumn<CoordinationIssue>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      cell: (i) => `CI-${String(i.number).padStart(3, '0')}`,
    },
    {
      id: 'title',
      header: 'Issue',
      cell: (i) => (
        <Button variant="tertiary" onClick={() => setParams({ issue: i.id })}>
          {i.title}
        </Button>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (i) => <StatusPill tone={statusTone(i.status)}>{STATUS_LABEL[i.status]}</StatusPill>,
    },
    {
      id: 'priority',
      header: 'Priority',
      cell: (i) => (
        <StatusPill tone={priorityTone(i.priority)}>{PRIORITY_LABEL[i.priority]}</StatusPill>
      ),
    },
    {
      id: 'assignee',
      header: 'Assigned to',
      cell: (i) => (i.assigneeId ? dir.personName(i.assigneeId) : '—'),
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

  const d = detail.data;
  return (
    <>
      <PageHeader
        eyebrow="Coordination"
        title="Coordination issues"
        description="Clashes and gaps found in the models. Pin each to the elements involved, assign it, and link the RFI that resolves it."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.coordinationCaptures(org.orgSlug, project.projectId)}
            >
              <CoordinationIcon size={16} aria-hidden="true" /> Site capture
            </Link>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.coordinationModels(org.orgSlug, project.projectId)}
            >
              <CoordinationIcon size={16} aria-hidden="true" /> Open 3D viewer
            </Link>
            <Button
              onClick={() => {
                m.raise.reset();
                setTitle('');
                setDescription('');
                setPriority('medium');
                setAssignee('');
                setModelId('');
                setLocation('');
                setGuids('');
                setRaising(true);
              }}
            >
              <Plus size={16} aria-hidden="true" /> Raise an issue
            </Button>
          </>
        }
      />
      <div className="stack-lg">
        <div className="stack-lg">
          <Card
            title="Issues"
            actions={
              <Select
                label="Status"
                value={status ?? ''}
                options={[
                  { value: '', label: 'All' },
                  ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
                ]}
                onChange={(e) => setParams({ status: e.target.value })}
              />
            }
          >
            <ErrorAlert error={issues.error} title="We couldn't load the coordination issues" />
            {issues.isPending ? (
              <SkeletonRows label="Loading coordination issues…" />
            ) : (issues.data ?? []).length === 0 ? (
              <EmptyState
                icon={CoordinationIcon}
                title="No coordination issues"
                description="Raise one when you find a clash or a gap in a model."
              />
            ) : (
              <DataTable
                caption="Coordination issues"
                columns={issueColumns}
                rows={issues.data ?? []}
                getRowId={(i) => i.id}
              />
            )}
          </Card>
          {selected ? (
            <Card title="Issue">
              <div className="stack">
                <ErrorAlert error={detail.error} title="We couldn't load this issue" />
                {detail.isPending ? (
                  <SkeletonRows label="Loading the issue…" />
                ) : d ? (
                  <>
                    <h3 id="issue-title" className="u-m-0">
                      {`CI-${String(d.issue.number).padStart(3, '0')} ${d.issue.title}`}
                    </h3>
                    {d.issue.description ? <p className="u-m-0">{d.issue.description}</p> : null}
                    <DescriptionList
                      items={[
                        { label: 'Model', value: modelName_(d.issue.modelId) },
                        { label: 'Location', value: d.issue.location || '—' },
                        {
                          label: 'Elements',
                          value: d.issue.elementGuids.length
                            ? d.issue.elementGuids.join(', ')
                            : '—',
                        },
                      ]}
                    />
                    <div className="u-row">
                      <StatusPill tone={statusTone(d.issue.status)}>
                        {STATUS_LABEL[d.issue.status]}
                      </StatusPill>
                      {nextStatuses(d.issue.status).map((s) => (
                        <Button
                          key={s}
                          variant="secondary"
                          disabled={m.change.isPending}
                          onClick={() =>
                            m.change.mutate({
                              issueId: d.issue.id,
                              version: d.issue.version,
                              changes: { status: s },
                            })
                          }
                        >
                          {s === 'open' ? 'Reopen' : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
                        </Button>
                      ))}
                    </div>
                    <ErrorAlert error={m.change.error} title="We couldn't change this issue" />
                    <h3 className="u-m-0">Comments</h3>
                    {d.comments.length === 0 ? <p className="u-m-0">No comments yet.</p> : null}
                    <ul aria-label="Comments" className="u-m-0">
                      {d.comments.map((c) => (
                        <li key={c.id}>
                          <strong>{dir.personName(c.authorId)}</strong>: {c.body}
                        </li>
                      ))}
                    </ul>
                    <Textarea
                      label="Add a comment"
                      rows={3}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                    <div className="u-row">
                      <Button
                        disabled={!comment.trim() || m.comment.isPending}
                        onClick={() =>
                          m.comment.mutate(
                            { issueId: d.issue.id, body: comment.trim() },
                            { onSuccess: () => setComment('') },
                          )
                        }
                      >
                        {m.comment.isPending ? 'Adding…' : 'Add comment'}
                      </Button>
                    </div>
                    <ErrorAlert error={m.comment.error} title="We couldn't add the comment" />
                  </>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
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

      <Dialog
        open={raising}
        onClose={() => setRaising(false)}
        title="Raise a coordination issue"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRaising(false)}>
              Cancel
            </Button>
            <Button
              disabled={!title.trim() || m.raise.isPending}
              onClick={() =>
                m.raise.mutate(
                  {
                    title: title.trim(),
                    ...(description.trim() ? { description: description.trim() } : {}),
                    priority,
                    ...(assignee ? { assigneeId: assignee } : {}),
                    ...(modelId ? { modelId } : {}),
                    ...(location.trim() ? { location: location.trim() } : {}),
                    ...(parseGuids(guids).length ? { elementGuids: parseGuids(guids) } : {}),
                  },
                  {
                    onSuccess: (x) => {
                      setRaising(false);
                      setParams({ issue: x.issue.id });
                    },
                  },
                )
              }
            >
              {m.raise.isPending ? 'Raising…' : 'Raise issue'}
            </Button>
          </>
        }
      >
        <div className="stack">
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Textarea
            label="What is the clash"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Select
            label="Priority"
            value={priority}
            options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p] }))}
            onChange={(e) => setPriority(e.target.value as CoordinationIssuePriority)}
          />
          <Select
            label="Assign to"
            value={assignee}
            options={[
              { value: '', label: 'Not assigned' },
              ...dir.people.map((p) => ({ value: p.id, label: p.name })),
            ]}
            onChange={(e) => setAssignee(e.target.value)}
          />
          <Select
            label="Model"
            value={modelId}
            options={[
              { value: '', label: 'Not set' },
              ...currentModels.map((x) => ({ value: x.id, label: x.name })),
            ]}
            onChange={(e) => setModelId(e.target.value)}
          />
          <TextField
            label="Location"
            placeholder="Level 2, grid C4"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <Textarea
            label="Element ids"
            hint="IFC GlobalIds, separated by spaces, commas or new lines"
            rows={2}
            value={guids}
            onChange={(e) => setGuids(e.target.value)}
          />
          <ErrorAlert error={m.raise.error} title="We couldn't raise the issue" />
        </div>
      </Dialog>

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
