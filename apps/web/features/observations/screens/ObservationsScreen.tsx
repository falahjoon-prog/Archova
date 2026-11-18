'use client';

import {
  CLASSIFICATION_LABELS,
  CONDITION_LABELS,
  TRADE_CATEGORY_LABELS,
  optionsOf,
  type ClassificationKey,
  type ConditionKey,
  type TradeCategoryKey,
} from '@/shared/lib/dbp';
import { useState } from 'react';
import {
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ObservationsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { LinkedIncidentActions } from '@/features/incidents';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { formatLocalDate } from '@/shared/lib/format';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useObservationMutations, useObservations } from '../hooks/useObservations';
import {
  ACTION_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TYPE_LABELS,
  needsReason,
  type Observation,
  type ObservationAction,
  type ObservationPriority,
  type ObservationStatus,
  type ObservationType,
} from '../lib/types';

const TYPES = Object.keys(TYPE_LABELS) as ObservationType[];
const STATUSES = Object.keys(STATUS_LABELS) as ObservationStatus[];
const PRIORITIES = Object.keys(PRIORITY_LABELS) as ObservationPriority[];
const STATUS_TONE: Record<ObservationStatus, StatusTone> = {
  open: 'warning',
  resolved: 'info',
  closed: 'success',
};

type Dialogs =
  | { kind: 'new' }
  | { kind: 'act'; observation: Observation; action: ObservationAction }
  | { kind: 'linked'; observation: Observation }
  | null;

/** The observation register: safety, quality, environmental and commercial observations raised on site. */
export function ObservationsScreen() {
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const [params, setParams] = useUrlState(['status', 'type', 'priority', 'overdue'] as const);
  const status = STATUSES.includes(params.status as ObservationStatus)
    ? (params.status as ObservationStatus)
    : undefined;
  const type = TYPES.includes(params.type as ObservationType)
    ? (params.type as ObservationType)
    : undefined;
  const priority = PRIORITIES.includes(params.priority as ObservationPriority)
    ? (params.priority as ObservationPriority)
    : undefined;
  const list = useObservations({
    status,
    type,
    priority,
    overdue: params.overdue === 'true' ? true : undefined,
  });
  const m = useObservationMutations();
  const [dialog, setDialog] = useState<Dialogs>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'observations', id: 'register' },
  });
  const filtered = Object.values(params).some(Boolean);

  const columns: DataTableColumn<Observation>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (o) => o.numberLabel,
      cell: (o) => o.numberLabel,
    },
    {
      id: 'what',
      header: 'Observation',
      cell: (o) => (
        <>
          {o.description}
          <span className="u-caption">
            {' '}
            · {TYPE_LABELS[o.type]}
            {o.location ? ` · ${o.location}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      sortValue: (o) => PRIORITIES.indexOf(o.priority),
      cell: (o) => PRIORITY_LABELS[o.priority],
    },
    {
      id: 'company',
      header: 'Assigned to',
      cell: (o) => (o.assigneeCompanyId ? dir.companyName(o.assigneeCompanyId) : 'Not assigned'),
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (o) => o.dueDate ?? '9999',
      cell: (o) =>
        o.dueDate ? (
          o.isOverdue ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(o.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(o.dueDate)
          )
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (o) => o.status,
      cell: (o) => <StatusPill tone={STATUS_TONE[o.status]}>{STATUS_LABELS[o.status]}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (o) => (
        <span className="u-row">
          {o.availableActions
            .filter((a) => a !== 'stopWork')
            .map((a) => (
              <Button
                key={a}
                variant="tertiary"
                aria-label={`${ACTION_LABELS[a]} ${o.numberLabel}`}
                onClick={() => setDialog({ kind: 'act', observation: o, action: a })}
              >
                {ACTION_LABELS[a]}
              </Button>
            ))}
          <Button
            variant="tertiary"
            aria-label={`Corrective actions from ${o.numberLabel}`}
            onClick={() => setDialog({ kind: 'linked', observation: o })}
          >
            Linked actions
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Observations"
        description="Raise safety, quality, environmental and commercial observations and follow them to close."
        actions={
          <Button onClick={() => setDialog({ kind: 'new' })}>
            <Plus size={16} aria-hidden="true" /> New observation
          </Button>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Observations" /> : null}
      <FilterBar label="Filter observations">
        <Select
          label="Status"
          value={params.status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Type"
          value={params.type}
          placeholder="Any type"
          options={TYPES.map((v) => ({ value: v, label: TYPE_LABELS[v] }))}
          onChange={(e) => setParams({ type: e.target.value })}
        />
        <Select
          label="Priority"
          value={params.priority}
          placeholder="Any priority"
          options={PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] }))}
          onChange={(e) => setParams({ priority: e.target.value })}
        />
        <Select
          label="Overdue"
          value={params.overdue}
          placeholder="All"
          options={[{ value: 'true', label: 'Overdue only' }]}
          onChange={(e) => setParams({ overdue: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load observations" />
      {list.isPending ? (
        <SkeletonRows label="Loading observations…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={ObservationsIcon}
          title={filtered ? 'No observations match' : 'No observations yet'}
          description={
            filtered
              ? 'Try a different filter.'
              : 'Raise one when you see a safety, quality or environmental issue on site.'
          }
        />
      ) : (
        <DataTable
          caption="Observations"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(o) => o.id}
        />
      )}

      {dialog?.kind === 'new' ? (
        <NewDialog
          dir={dir}
          pending={m.create.isPending}
          error={m.create.error}
          onClose={() => setDialog(null)}
          onSave={(input) => m.create.mutate(input, { onSuccess: () => setDialog(null) })}
        />
      ) : null}
      {dialog?.kind === 'linked' ? (
        <Dialog
          open
          onClose={() => setDialog(null)}
          title={`Corrective actions from ${dialog.observation.numberLabel}`}
          footer={
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Close
            </Button>
          }
        >
          <LinkedIncidentActions
            showEmpty
            source={{ type: 'observation', id: dialog.observation.id }}
          />
        </Dialog>
      ) : null}
      {dialog?.kind === 'act' ? (
        <ActionDialog
          observation={dialog.observation}
          action={dialog.action}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setDialog(null)}
          onConfirm={(reason) =>
            m.transition.mutate(
              {
                observation: dialog.observation,
                input: { action: dialog.action, reason: reason || undefined },
              },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
    </>
  );
}

function NewDialog({
  dir,
  pending,
  error,
  onClose,
  onSave,
}: {
  dir: ReturnType<typeof useProjectDirectory>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: {
    type: ObservationType;
    description: string;
    hazard?: string;
    location?: string;
    priority: ObservationPriority;
    tradeCategory?: TradeCategoryKey;
    classification?: ClassificationKey;
    contributingCondition?: ConditionKey;
    assigneeCompanyId?: string;
    dueDate?: string;
  }) => void;
}) {
  const [type, setType] = useState<ObservationType>('safety');
  const [description, setDescription] = useState('');
  const [hazard, setHazard] = useState('');
  const [location, setLocation] = useState('');
  const [priority, setPriority] = useState<ObservationPriority>('medium');
  const [tradeCategory, setTradeCategory] = useState('');
  const [classification, setClassification] = useState('');
  const [condition, setCondition] = useState('');
  const [company, setCompany] = useState('');
  const [dueDate, setDueDate] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="New observation"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!description.trim() || pending}
            onClick={() =>
              onSave({
                type,
                description: description.trim(),
                hazard: hazard.trim() || undefined,
                location: location.trim() || undefined,
                priority,
                tradeCategory: (tradeCategory || undefined) as TradeCategoryKey | undefined,
                classification: (classification || undefined) as ClassificationKey | undefined,
                contributingCondition: (condition || undefined) as ConditionKey | undefined,
                assigneeCompanyId: company || undefined,
                dueDate: dueDate || undefined,
              })
            }
          >
            {pending ? 'Saving…' : 'Raise observation'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Type"
          value={type}
          options={TYPES.map((v) => ({ value: v, label: TYPE_LABELS[v] }))}
          onChange={(e) => setType(e.target.value as ObservationType)}
        />
        <Textarea
          label="What did you see?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {type === 'safety' ? (
          <TextField label="Hazard" value={hazard} onChange={(e) => setHazard(e.target.value)} />
        ) : null}
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <Select
          label="Priority"
          value={priority}
          options={PRIORITIES.map((v) => ({ value: v, label: PRIORITY_LABELS[v] }))}
          onChange={(e) => setPriority(e.target.value as ObservationPriority)}
        />
        {type === 'quality' ? (
          <>
            <Select
              label="Building element"
              value={tradeCategory}
              placeholder="Not set"
              hint="For DBP Act reporting."
              options={optionsOf(TRADE_CATEGORY_LABELS)}
              onChange={(e) => setTradeCategory(e.target.value)}
            />
            <Select
              label="Risk classification"
              value={classification}
              placeholder="Not yet classified"
              hint="Your call as the responsible person; Archova does not classify for you."
              options={optionsOf(CLASSIFICATION_LABELS)}
              onChange={(e) => setClassification(e.target.value)}
            />
            <Select
              label="Contributing condition"
              value={condition}
              placeholder="Not recorded"
              options={optionsOf(CONDITION_LABELS)}
              onChange={(e) => setCondition(e.target.value)}
            />
          </>
        ) : null}
        <Select
          label="Assign to"

          value={company}
          placeholder="Not assigned"
          options={dir.companies
            .filter((c) => dir.onProject(c.id))
            .map((c) => ({ value: c.id, label: c.name }))}
          onChange={(e) => setCompany(e.target.value)}
        />
        <TextField
          label="Due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't raise the observation" />
      </div>
    </Dialog>
  );
}

function ActionDialog({
  observation,
  action,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  observation: Observation;
  action: ObservationAction;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const required = needsReason(action);
  const takesNote = required || action === 'resolve';
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} ${observation.numberLabel}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={(required && !reason.trim()) || pending}
            onClick={() => onConfirm(reason.trim())}
          >
            {pending ? 'Saving…' : ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="u-m-0">{observation.description}</p>
        {takesNote ? (
          <Textarea
            label={action === 'resolve' ? 'What was done? (optional)' : 'Reason'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        ) : null}
        <ErrorAlert error={error} title="We couldn't update the observation" />
      </div>
    </Dialog>
  );
}
