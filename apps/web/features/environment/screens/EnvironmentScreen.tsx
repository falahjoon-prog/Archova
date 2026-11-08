'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  Tabs,
  TextField,
  Textarea,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { InspectionsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { MonitoringTab } from './MonitoringTab';
import {
  useConditionDetail,
  useConditions,
  useEnvironmentDocuments,
  useEnvironmentMutations,
  useEnvironmentSummary,
} from '../hooks/useEnvironment';
import {
  ACTION_LABELS,
  CATEGORY_LABELS,
  DOCUMENT_TYPE_LABELS,
  FREQUENCY_LABELS,
  SOURCE_LABELS,
  STATUS_LABELS,
  needsNote,
  type Condition,
  type ConditionAction,
  type ConditionCategory,
  type ConditionFrequency,
  type ConditionSource,
  type ConditionStatus,
  type DocumentType,
  type EnvironmentDocument,
  type Flag,
} from '../lib/types';

const CATEGORIES = Object.keys(CATEGORY_LABELS) as ConditionCategory[];
const STATUSES = Object.keys(STATUS_LABELS) as ConditionStatus[];
const SOURCES = Object.keys(SOURCE_LABELS) as ConditionSource[];
const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as ConditionFrequency[];
const DOC_TYPES = Object.keys(DOCUMENT_TYPE_LABELS) as DocumentType[];
const TABS = [
  { id: 'conditions', label: 'Conditions' },
  { id: 'monitoring', label: 'Monitoring' },
  { id: 'documents', label: 'Documents' },
  { id: 'plan', label: 'Plan' },
] as const;

const STATUS_TONE: Record<ConditionStatus, StatusTone> = {
  not_started: 'neutral',
  in_progress: 'info',
  compliant: 'success',
  non_compliant: 'danger',
  not_applicable: 'neutral',
};
const FLAG_TONE = { critical: 'danger', warning: 'warning', info: 'info' } as const;
const EXPIRY_TONE: Record<EnvironmentDocument['expiry'], StatusTone | null> = {
  none: null,
  valid: 'success',
  expiring: 'warning',
  expired: 'danger',
};
const EXPIRY_LABEL: Record<EnvironmentDocument['expiry'], string> = {
  none: '',
  valid: 'Current',
  expiring: 'Expiring soon',
  expired: 'Expired',
};

type Dialogs =
  | { kind: 'new' }
  | { kind: 'act'; condition: Condition; action: ConditionAction }
  | { kind: 'history'; condition: Condition }
  | { kind: 'document' }
  | null;

/** The project's Environmental Management Plan, its compliance-condition register and its permits and licences. */
export function EnvironmentScreen() {
  const project = useCurrentProject();
  const [params, setParams] = useUrlState(['tab', 'status', 'category', 'overdue'] as const);
  const tab = TABS.find((t) => t.id === params.tab)?.id ?? 'conditions';
  const summary = useEnvironmentSummary();
  const m = useEnvironmentMutations();
  const [dialog, setDialog] = useState<Dialogs>(null);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'environment', id: 'register' },
  });
  const s = summary.data;

  return (
    <>
      <PageHeader
        eyebrow="Environment and sustainability"
        title="Environmental management"
        description="Keep the EMP, every permit and licence condition, and the sign-offs that prove compliance in one register."
      />
      {previewDataOnly ? <PreviewDataNotice tool="Environment" /> : null}
      <ErrorAlert error={summary.error} title="We couldn't load the environmental summary" />
      {s ? (
        <>
          {s.flags.length > 0 ? (
            <div className="stack" aria-label="Nova flags">
              {s.flags.map((f: Flag) => (
                <Alert key={f.code} tone={FLAG_TONE[f.severity]} title="Nova">
                  {f.message}
                </Alert>
              ))}
            </div>
          ) : null}
          <StatGrid
            items={[
              {
                label: 'Compliance',
                value:
                  s.conditions.compliancePercent === null
                    ? '—'
                    : `${s.conditions.compliancePercent}%`,
                hint: `${s.conditions.byStatus.compliant} of ${s.conditions.total - s.conditions.byStatus.not_applicable} signed off`,
                tone:
                  s.conditions.compliancePercent === null
                    ? 'neutral'
                    : s.conditions.compliancePercent >= 80
                      ? 'success'
                      : 'warning',
              },
              {
                label: 'Non-compliant',
                value: s.conditions.byStatus.non_compliant,
                tone: s.conditions.byStatus.non_compliant > 0 ? 'danger' : 'neutral',
              },
              {
                label: 'Overdue sign-offs',
                value: s.conditions.overdue,
                tone: s.conditions.overdue > 0 ? 'warning' : 'neutral',
              },
              {
                label: 'Open breaches',
                value: s.monitoring.openBreaches,
                hint: `${s.monitoring.points} monitoring ${s.monitoring.points === 1 ? 'point' : 'points'}`,
                tone: s.monitoring.openBreaches > 0 ? 'danger' : 'neutral',
              },
              {
                label: 'Documents lapsing',
                value: s.documents.expired + s.documents.expiring,
                hint: `${s.documents.expired} expired · ${s.documents.expiring} within 30 days`,
                tone:
                  s.documents.expired > 0
                    ? 'danger'
                    : s.documents.expiring > 0
                      ? 'warning'
                      : 'neutral',
              },
            ]}
          />
        </>
      ) : summary.isPending ? (
        <SkeletonRows label="Loading summary…" />
      ) : null}

      <Tabs
        label="Environmental management"
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setParams({ tab: id === 'conditions' ? '' : id })}
      >
        {tab === 'conditions' ? (
          <ConditionsTab
            status={params.status}
            category={params.category}
            overdue={params.overdue}
            setParams={setParams}
            onAdd={() => setDialog({ kind: 'new' })}
            onStarter={() => m.starterPack.mutate()}
            starterPending={m.starterPack.isPending}
            onAct={(condition, action) => setDialog({ kind: 'act', condition, action })}
            onHistory={(condition) => setDialog({ kind: 'history', condition })}
          />
        ) : tab === 'monitoring' ? (
          <MonitoringTab />
        ) : tab === 'documents' ? (
          <DocumentsTab onAdd={() => setDialog({ kind: 'document' })} />
        ) : (
          <PlanTab />
        )}
      </Tabs>

      {dialog?.kind === 'new' ? (
        <NewConditionDialog
          pending={m.createCondition.isPending}
          error={m.createCondition.error}
          onClose={() => setDialog(null)}
          onSave={(input) => m.createCondition.mutate(input, { onSuccess: () => setDialog(null) })}
        />
      ) : null}
      {dialog?.kind === 'act' ? (
        <ActionDialog
          condition={dialog.condition}
          action={dialog.action}
          pending={m.transition.isPending}
          error={m.transition.error}
          onClose={() => setDialog(null)}
          onConfirm={(note, files) =>
            m.transition.mutate(
              {
                condition: dialog.condition,
                input: { action: dialog.action, note: note || undefined, files },
              },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
      {dialog?.kind === 'history' ? (
        <HistoryDialog condition={dialog.condition} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'document' ? (
        <NewDocumentDialog
          pending={m.createDocument.isPending}
          error={m.createDocument.error}
          onClose={() => setDialog(null)}
          onSave={(input) => m.createDocument.mutate(input, { onSuccess: () => setDialog(null) })}
        />
      ) : null}
    </>
  );
}

function ConditionsTab({
  status,
  category,
  overdue,
  setParams,
  onAdd,
  onStarter,
  starterPending,
  onAct,
  onHistory,
}: {
  status: string;
  category: string;
  overdue: string;
  setParams: (p: Record<string, string>) => void;
  onAdd: () => void;
  onStarter: () => void;
  starterPending: boolean;
  onAct: (c: Condition, a: ConditionAction) => void;
  onHistory: (c: Condition) => void;
}) {
  const list = useConditions({
    status: STATUSES.includes(status as ConditionStatus) ? (status as ConditionStatus) : undefined,
    category: CATEGORIES.includes(category as ConditionCategory)
      ? (category as ConditionCategory)
      : undefined,
    overdue: overdue === 'true' ? true : undefined,
  });
  const filtered = Boolean(status || category || overdue);
  const columns: DataTableColumn<Condition>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (c) => c.numberLabel,
      cell: (c) => c.numberLabel,
    },
    {
      id: 'what',
      header: 'Condition',
      cell: (c) => (
        <>
          {c.title}
          <span className="u-caption">
            {' '}
            · {CATEGORY_LABELS[c.category]} · {SOURCE_LABELS[c.source]}
            {c.sourceReference ? ` (${c.sourceReference})` : ''}
          </span>
        </>
      ),
    },
    { id: 'freq', header: 'Checked', cell: (c) => FREQUENCY_LABELS[c.frequency] },
    {
      id: 'due',
      header: 'Next due',
      sortValue: (c) => c.dueDate ?? '9999',
      cell: (c) =>
        c.dueDate ? (
          c.isOverdue ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(c.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(c.dueDate)
          )
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (c) => c.status,
      cell: (c) => <StatusPill tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status]}</StatusPill>,
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (c) => (
        <span className="u-row">
          {c.availableActions.map((a) => (
            <Button
              key={a}
              variant="tertiary"
              aria-label={`${ACTION_LABELS[a]} ${c.numberLabel}`}
              onClick={() => onAct(c, a)}
            >
              {ACTION_LABELS[a]}
            </Button>
          ))}
          <Button
            variant="tertiary"
            aria-label={`History of ${c.numberLabel}`}
            onClick={() => onHistory(c)}
          >
            History
          </Button>
        </span>
      ),
    },
  ];
  return (
    <div className="stack">
      <div className="u-row">
        <Button onClick={onAdd}>
          <Plus size={16} aria-hidden="true" /> Add condition
        </Button>
        <Button variant="secondary" disabled={starterPending} onClick={onStarter}>
          {starterPending ? 'Loading…' : 'Load standard conditions'}
        </Button>
      </div>
      <FilterBar label="Filter conditions">
        <Select
          label="Status"
          value={status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setParams({ status: e.target.value })}
        />
        <Select
          label="Category"
          value={category}
          placeholder="Any category"
          options={CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABELS[v] }))}
          onChange={(e) => setParams({ category: e.target.value })}
        />
        <Select
          label="Overdue"
          value={overdue}
          placeholder="All"
          options={[{ value: 'true', label: 'Overdue only' }]}
          onChange={(e) => setParams({ overdue: e.target.value })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load conditions" />
      {list.isPending ? (
        <SkeletonRows label="Loading conditions…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title={filtered ? 'No conditions match' : 'No conditions yet'}
          description={
            filtered
              ? 'Try a different filter.'
              : 'Add the conditions from your permit, or load the standard set and edit it.'
          }
        />
      ) : (
        <DataTable
          caption="Environmental conditions"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(c) => c.id}
        />
      )}
    </div>
  );
}

function DocumentsTab({ onAdd }: { onAdd: () => void }) {
  const docs = useEnvironmentDocuments();
  const m = useEnvironmentMutations();
  const columns: DataTableColumn<EnvironmentDocument>[] = [
    { id: 'title', header: 'Document', rowHeader: true, cell: (d) => d.title },
    { id: 'type', header: 'Type', cell: (d) => DOCUMENT_TYPE_LABELS[d.docType] },
    { id: 'ref', header: 'Reference', cell: (d) => d.reference ?? '—' },
    {
      id: 'expires',
      header: 'Expires',
      sortValue: (d) => d.expiresOn ?? '9999',
      cell: (d) => {
        const tone = EXPIRY_TONE[d.expiry];
        return d.expiresOn ? (
          <>
            {formatLocalDate(d.expiresOn)}{' '}
            {tone ? <StatusPill tone={tone}>{EXPIRY_LABEL[d.expiry]}</StatusPill> : null}
          </>
        ) : (
          '—'
        );
      },
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (d) => (
        <Button
          variant="tertiary"
          aria-label={`Remove ${d.title}`}
          disabled={m.deleteDocument.isPending}
          onClick={() => m.deleteDocument.mutate(d)}
        >
          Remove
        </Button>
      ),
    },
  ];
  return (
    <div className="stack">
      <div className="u-row">
        <Button onClick={onAdd}>
          <Plus size={16} aria-hidden="true" /> Add document
        </Button>
      </div>
      <ErrorAlert error={docs.error ?? m.deleteDocument.error} title="We couldn't load documents" />
      {docs.isPending ? (
        <SkeletonRows label="Loading documents…" />
      ) : (docs.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="No documents yet"
          description="Add the permit, EPA licence, approval letters and audit reports so expiries are tracked."
        />
      ) : (
        <DataTable
          caption="Environmental documents"
          columns={columns}
          rows={docs.data ?? []}
          getRowId={(d) => d.id}
        />
      )}
    </div>
  );
}

function PlanTab() {
  const summary = useEnvironmentSummary();
  const m = useEnvironmentMutations();
  const [title, setTitle] = useState('');
  const [permit, setPermit] = useState('');
  const plan = summary.data?.plan ?? null;
  if (summary.isPending) return <SkeletonRows label="Loading plan…" />;
  if (!plan)
    return (
      <div className="stack">
        <EmptyState
          icon={InspectionsIcon}
          title="No Environmental Management Plan yet"
          description="Name the plan and the permit it answers to. You can approve it once the conditions are loaded."
        />
        <TextField label="Plan title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <TextField
          label="Permit or licence reference"
          value={permit}
          onChange={(e) => setPermit(e.target.value)}
        />
        <ErrorAlert error={m.createPlan.error} title="We couldn't create the plan" />
        <div className="u-row">
          <Button
            disabled={!title.trim() || m.createPlan.isPending}
            onClick={() =>
              m.createPlan.mutate({
                title: title.trim(),
                permitReference: permit.trim() || undefined,
              })
            }
          >
            {m.createPlan.isPending ? 'Saving…' : 'Create plan'}
          </Button>
        </div>
      </div>
    );
  return (
    <div className="stack">
      <h2 className="u-m-0">{plan.title}</h2>
      <p className="u-m-0">
        <StatusPill tone={plan.status === 'active' ? 'success' : 'warning'}>
          {plan.status === 'active' ? 'Approved' : 'Draft'}
        </StatusPill>{' '}
        {plan.permitReference ? `Permit ${plan.permitReference} · ` : ''}
        Reviewed every {plan.reviewIntervalMonths} months
        {plan.nextReviewDate ? ` · next review ${formatLocalDate(plan.nextReviewDate)}` : ''}
      </p>
      {plan.summary ? <p className="u-m-0">{plan.summary}</p> : null}
      <ErrorAlert error={m.approvePlan.error} title="We couldn't approve the plan" />
      {plan.status === 'draft' ? (
        <div className="u-row">
          <Button disabled={m.approvePlan.isPending} onClick={() => m.approvePlan.mutate(plan)}>
            {m.approvePlan.isPending ? 'Approving…' : 'Approve plan'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function NewConditionDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: {
    title: string;
    category: ConditionCategory;
    source: ConditionSource;
    sourceReference?: string;
    requirement?: string;
    frequency: ConditionFrequency;
    dueDate?: string;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<ConditionCategory>('air_quality');
  const [source, setSource] = useState<ConditionSource>('planning_permit');
  const [reference, setReference] = useState('');
  const [requirement, setRequirement] = useState('');
  const [frequency, setFrequency] = useState<ConditionFrequency>('weekly');
  const [dueDate, setDueDate] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add condition"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || pending}
            onClick={() =>
              onSave({
                title: title.trim(),
                category,
                source,
                sourceReference: reference.trim() || undefined,
                requirement: requirement.trim() || undefined,
                frequency,
                dueDate: dueDate || undefined,
              })
            }
          >
            {pending ? 'Saving…' : 'Add condition'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Condition" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          label="What it requires"
          value={requirement}
          onChange={(e) => setRequirement(e.target.value)}
        />
        <Select
          label="Category"
          value={category}
          options={CATEGORIES.map((v) => ({ value: v, label: CATEGORY_LABELS[v] }))}
          onChange={(e) => setCategory(e.target.value as ConditionCategory)}
        />
        <Select
          label="Source"
          value={source}
          options={SOURCES.map((v) => ({ value: v, label: SOURCE_LABELS[v] }))}
          onChange={(e) => setSource(e.target.value as ConditionSource)}
        />
        <TextField
          label="Source reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <Select
          label="How often it is checked"
          value={frequency}
          options={FREQUENCIES.map((v) => ({ value: v, label: FREQUENCY_LABELS[v] }))}
          onChange={(e) => setFrequency(e.target.value as ConditionFrequency)}
        />
        <TextField
          label="First due date"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't add the condition" />
      </div>
    </Dialog>
  );
}

function ActionDialog({
  condition,
  action,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  condition: Condition;
  action: ConditionAction;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: (note: string, files: File[]) => void;
}) {
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const required = needsNote(action);
  const signing = action === 'signOff';
  const takesNote = required || signing;
  // A sign-off needs something to stand behind: a note, new evidence, or evidence already attached.
  const ready = required
    ? note.trim() !== ''
    : signing
      ? note.trim() !== '' || files.length > 0 || condition.evidenceCount > 0
      : true;
  return (
    <Dialog
      open
      onClose={onClose}
      title={`${ACTION_LABELS[action]} ${condition.numberLabel}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || pending} onClick={() => onConfirm(note.trim(), files)}>
            {pending ? 'Saving…' : ACTION_LABELS[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="u-m-0">{condition.title}</p>
        {takesNote ? (
          <Textarea
            label={signing ? 'What was checked? (or attach evidence)' : 'Reason'}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        ) : null}
        {signing ? (
          <label className="u-caption">
            Evidence photos or documents
            <input
              type="file"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
          </label>
        ) : null}
        <ErrorAlert error={error} title="We couldn't update the condition" />
      </div>
    </Dialog>
  );
}

const EVENT_LABEL = {
  start: 'Started',
  sign_off: 'Signed off',
  flag_non_compliant: 'Flagged non-compliant',
  not_applicable: 'Marked not applicable',
  reopen: 'Reopened',
} as const;

function HistoryDialog({ condition, onClose }: { condition: Condition; onClose: () => void }) {
  const detail = useConditionDetail(condition.id);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`History of ${condition.numberLabel}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="stack">
        <p className="u-m-0">{condition.title}</p>
        <ErrorAlert error={detail.error} title="We couldn't load the history" />
        {detail.isPending ? (
          <SkeletonRows label="Loading history…" />
        ) : (detail.data?.events ?? []).length === 0 ? (
          <p className="u-m-0">No sign-offs or status changes yet.</p>
        ) : (
          <ol className="stack">
            {detail.data!.events.map((e) => (
              <li key={e.id}>
                <strong>{EVENT_LABEL[e.action]}</strong>{' '}
                <span className="u-caption">
                  {new Date(e.at).toLocaleDateString('en-AU')}
                  {e.evidenceCount > 0
                    ? ` · ${e.evidenceCount} file${e.evidenceCount === 1 ? '' : 's'}`
                    : ''}
                </span>
                {e.note ? <p className="u-m-0">{e.note}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Dialog>
  );
}

function NewDocumentDialog({
  pending,
  error,
  onClose,
  onSave,
}: {
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSave: (input: {
    title: string;
    docType: DocumentType;
    reference?: string;
    issuedOn?: string;
    expiresOn?: string;
    file: File;
  }) => void;
}) {
  const [title, setTitle] = useState('');
  const [docType, setDocType] = useState<DocumentType>('permit');
  const [reference, setReference] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add document"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || !file || pending}
            onClick={() =>
              file &&
              onSave({
                title: title.trim(),
                docType,
                reference: reference.trim() || undefined,
                issuedOn: issuedOn || undefined,
                expiresOn: expiresOn || undefined,
                file,
              })
            }
          >
            {pending ? 'Uploading…' : 'Add document'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Select
          label="Type"
          value={docType}
          options={DOC_TYPES.map((v) => ({ value: v, label: DOCUMENT_TYPE_LABELS[v] }))}
          onChange={(e) => setDocType(e.target.value as DocumentType)}
        />
        <TextField
          label="Reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        <TextField
          label="Issued"
          type="date"
          value={issuedOn}
          onChange={(e) => setIssuedOn(e.target.value)}
        />
        <TextField
          label="Expires"
          type="date"
          value={expiresOn}
          onChange={(e) => setExpiresOn(e.target.value)}
        />
        <label className="u-caption">
          File
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <ErrorAlert error={error} title="We couldn't add the document" />
      </div>
    </Dialog>
  );
}
