'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Alert,
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
  Textarea,
  buttonClassName,
  type DataTableColumn,
  type StatusTone,
} from '@archova/ui';
import { ChevronLeft, InspectionsIcon, Plus } from '@archova/ui/icons';
import { LinkedIncidentActions } from '@/features/incidents';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import {
  useInspection,
  useInspectionMutations,
  useInspections,
  useTemplates,
} from '../hooks/useInspections';
import {
  RESULT_LABELS,
  STATUS_LABELS,
  type Answer,
  type AnswerInput,
  type Inspection,
  type InspectionDetail,
  type InspectionResult,
  type InspectionStatus,
  type TemplateItem,
} from '../lib/types';

const STATUSES = Object.keys(STATUS_LABELS) as InspectionStatus[];
const TONE: Record<InspectionStatus, StatusTone> = {
  scheduled: 'neutral',
  in_progress: 'info',
  submitted: 'warning',
  closed: 'success',
};

/** The inspection register. `?id=` opens one inspection to fill in, sign and submit. */
export function InspectionsScreen() {
  const [params, setParams] = useUrlState(['status', 'id'] as const);
  return params.id ? (
    <Runner id={params.id} />
  ) : (
    <RunList status={params.status} setStatus={(v) => setParams({ status: v })} />
  );
}

function RunList({ status, setStatus }: { status: string; setStatus: (v: string) => void }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const valid = STATUSES.includes(status as InspectionStatus)
    ? (status as InspectionStatus)
    : undefined;
  const list = useInspections({ status: valid });
  const templates = useTemplates();
  const m = useInspectionMutations();
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'inspections', id: 'register' },
  });

  const columns: DataTableColumn<Inspection>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (i) => i.numberLabel,
      cell: (i) => (
        <Link
          href={webRoutes.inspections(org.orgSlug, project.projectId, i.id)}
          aria-label={`${i.numberLabel} ${i.title}`}
        >
          {i.numberLabel}
        </Link>
      ),
    },
    { id: 'title', header: 'Inspection', sortValue: (i) => i.title, cell: (i) => i.title },
    { id: 'location', header: 'Location', cell: (i) => i.location ?? '—' },
    {
      id: 'scheduled',
      header: 'Scheduled',
      sortValue: (i) => i.scheduledFor ?? '9999',
      cell: (i) => (i.scheduledFor ? formatLocalDate(i.scheduledFor) : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (i) => i.status,
      cell: (i) => <StatusPill tone={TONE[i.status]}>{STATUS_LABELS[i.status]}</StatusPill>,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Inspections"
        description="Run checklists on site: ITPs, pre-pour checks, handover and safety walks."
        actions={
          <>
            <Link
              className={buttonClassName('secondary')}
              href={webRoutes.inspectionTemplates(org.orgSlug, project.projectId)}
            >
              Checklists
            </Link>
            <Button onClick={() => setStarting(true)}>
              <Plus size={16} aria-hidden="true" /> Start inspection
            </Button>
          </>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Inspections" /> : null}
      <FilterBar label="Filter inspections">
        <Select
          label="Status"
          value={status}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => setStatus(e.target.value)}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load inspections" />
      {list.isPending ? (
        <SkeletonRows label="Loading inspections…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title={valid ? 'No inspections match' : 'No inspections yet'}
          description={
            valid
              ? 'Try a different status.'
              : 'Start one from a published checklist. Build checklists first if you have none.'
          }
        />
      ) : (
        <DataTable
          caption="Inspections"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(i) => i.id}
        />
      )}
      {starting ? (
        <StartDialog
          templates={(templates.data ?? []).filter((t) => t.published)}
          pending={m.start.isPending}
          error={m.start.error}
          onClose={() => setStarting(false)}
          onStart={(input) =>
            m.start.mutate(input, {
              onSuccess: (d) => {
                setStarting(false);
                router.push(webRoutes.inspections(org.orgSlug, project.projectId, d.inspection.id));
              },
            })
          }
        />
      ) : null}
    </>
  );
}

function StartDialog({
  templates,
  pending,
  error,
  onClose,
  onStart,
}: {
  templates: Array<{ id: string; name: string; version: number }>;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onStart: (input: {
    templateId: string;
    title?: string;
    location?: string;
    scheduledFor?: string;
  }) => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Start inspection"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!templateId || pending}
            onClick={() =>
              onStart({
                templateId,
                title: title.trim() || undefined,
                location: location.trim() || undefined,
                scheduledFor: scheduledFor || undefined,
              })
            }
          >
            {pending ? 'Starting…' : 'Start'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Select
          label="Checklist"
          value={templateId}
          placeholder="Choose a published checklist"
          options={templates.map((t) => ({ value: t.id, label: `${t.name} (v${t.version})` }))}
          onChange={(e) => setTemplateId(e.target.value)}
        />
        {templates.length === 0 ? (
          <Alert tone="info">No published checklists yet. Publish one under Checklists.</Alert>
        ) : null}
        <TextField
          label="Title"
          value={title}
          hint="Defaults to the checklist name."
          onChange={(e) => setTitle(e.target.value)}
        />
        <TextField
          label="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        />
        <TextField
          label="Scheduled for"
          type="date"
          value={scheduledFor}
          onChange={(e) => setScheduledFor(e.target.value)}
        />
        <ErrorAlert error={error} title="We couldn't start the inspection" />
      </div>
    </Dialog>
  );
}

type Draft = Record<string, { value: string; result: InspectionResult | ''; note: string }>;

const fromAnswers = (answers: Answer[]): Draft =>
  Object.fromEntries(
    answers.map((a) => [
      a.templateItemId,
      {
        value: a.value === null ? '' : String(a.value),
        result: a.result ?? '',
        note: a.note ?? '',
      },
    ]),
  );

function toInput(item: TemplateItem, d: Draft[string] | undefined): AnswerInput | null {
  if (!d) return null;
  const note = d.note.trim() || undefined;
  if (item.responseType === 'pass_fail_na') {
    return d.result ? { templateItemId: item.id, result: d.result, note } : null;
  }
  if (d.value === '') return null;
  if (item.responseType === 'yes_no')
    return { templateItemId: item.id, value: d.value === 'yes', note };
  if (item.responseType === 'number')
    return { templateItemId: item.id, value: Number(d.value), note };
  return { templateItemId: item.id, value: d.value, note };
}

function Runner({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const q = useInspection(id);
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'inspections', id } });
  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.inspections(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Inspections
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading inspection…" />;
  if (!q.data) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="Inspection" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this inspection" />
      </>
    );
  }
  // Keyed by inspection only: re-keying on every save would reset the open sign dialog and the draft.
  return <RunnerBody key={q.data.inspection.id} detail={q.data} back={back} />;
}

function RunnerBody({ detail, back }: { detail: InspectionDetail; back: React.ReactNode }) {
  const m = useInspectionMutations();
  const [draft, setDraft] = useState<Draft>(() => fromAnswers(detail.responses));
  const [signing, setSigning] = useState(false);
  const i = detail.inspection;
  const editable = i.status === 'scheduled' || i.status === 'in_progress';
  const set = (itemId: string, patch: Partial<Draft[string]>) =>
    setDraft((cur) => ({
      ...cur,
      [itemId]: { value: '', result: '', note: '', ...cur[itemId], ...patch },
    }));
  const answers = detail.items
    .map((item) => toInput(item, draft[item.id]))
    .filter((a): a is AnswerInput => a !== null);
  const localMissing = detail.items.filter(
    (item) => item.required && item.responseType !== 'photo' && !toInput(item, draft[item.id]),
  ).length;
  const sections = [...new Set(detail.items.map((x) => x.section))];

  return (
    <>
      <PageHeader
        eyebrow={`${i.numberLabel} · ${i.location ?? 'No location'}`}
        title={i.title}
        actions={
          <>
            {back}
            {editable ? (
              <>
                <Button
                  variant="secondary"
                  disabled={answers.length === 0 || m.record.isPending}
                  onClick={() => m.record.mutate({ id: i.id, answers })}
                >
                  {m.record.isPending ? 'Saving…' : 'Save answers'}
                </Button>
                <Button onClick={() => setSigning(true)}>Sign and submit</Button>
              </>
            ) : null}
            {i.status === 'submitted' ? (
              <Button disabled={m.close.isPending} onClick={() => m.close.mutate(detail)}>
                Close inspection
              </Button>
            ) : null}
          </>
        }
      />
      <p>
        <StatusPill tone={TONE[i.status]}>{STATUS_LABELS[i.status]}</StatusPill>
        {i.signedByName ? <span className="u-caption"> · Signed by {i.signedByName}</span> : null}
      </p>
      <ErrorAlert error={m.record.error ?? m.close.error} title="Something went wrong" />
      {i.status === 'submitted' || i.status === 'closed' ? (
        detail.failedItemIds.length > 0 ? (
          <Alert tone="warning" title="Failed items">
            {detail.failedItemIds.length} item(s) failed. Raise defects for those marked to create
            one.
          </Alert>
        ) : null
      ) : null}
      {sections.map((section) => (
        <Card key={section} title={section || 'Items'}>
          <div className="stack">
            {detail.items
              .filter((x) => x.section === section)
              .map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  value={draft[item.id]}
                  editable={editable}
                  failed={detail.failedItemIds.includes(item.id)}
                  onChange={(patch) => set(item.id, patch)}
                />
              ))}
          </div>
        </Card>
      ))}
      <LinkedIncidentActions source={{ type: 'inspection', id: i.id }} />
      {signing ? (
        <SignDialog
          missing={localMissing}
          pending={m.submit.isPending || m.record.isPending}
          error={m.submit.error}
          onClose={() => setSigning(false)}
          onSign={async (name) => {
            // Saving answers bumps the version, so sign against the saved copy, not the one on screen.
            const saved =
              answers.length > 0 ? await m.record.mutateAsync({ id: i.id, answers }) : detail;
            m.submit.mutate(
              { detail: saved, signedByName: name },
              { onSuccess: () => setSigning(false) },
            );
          }}
        />
      ) : null}
    </>
  );
}

function ItemRow({
  item,
  value,
  editable,
  failed,
  onChange,
}: {
  item: TemplateItem;
  value: Draft[string] | undefined;
  editable: boolean;
  failed: boolean;
  onChange: (patch: Partial<Draft[string]>) => void;
}) {
  const v = value ?? { value: '', result: '' as const, note: '' };
  const label = `${item.prompt}${item.required ? '' : ' (optional)'}`;
  let control: React.ReactNode;
  switch (item.responseType) {
    case 'pass_fail_na':
      control = (
        <Select
          label={label}
          value={v.result}
          placeholder="Not answered"
          disabled={!editable}
          options={(Object.keys(RESULT_LABELS) as InspectionResult[]).map((r) => ({
            value: r,
            label: RESULT_LABELS[r],
          }))}
          onChange={(e) => onChange({ result: e.target.value as InspectionResult | '' })}
        />
      );
      break;
    case 'yes_no':
      control = (
        <Select
          label={label}
          value={v.value}
          placeholder="Not answered"
          disabled={!editable}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
      break;
    case 'select':
      control = (
        <Select
          label={label}
          value={v.value}
          placeholder="Not answered"
          disabled={!editable}
          options={item.options.map((o) => ({ value: o, label: o }))}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
      break;
    case 'photo':
      control = <p className="u-muted">{label}: photos are added from the mobile app for now.</p>;
      break;
    default:
      control = (
        <TextField
          label={item.responseType === 'signature' ? `${label} (type a name)` : label}
          type={item.responseType === 'number' ? 'number' : 'text'}
          value={v.value}
          disabled={!editable}
          onChange={(e) => onChange({ value: e.target.value })}
        />
      );
  }
  return (
    <div className="stack">
      {control}
      {failed ? <StatusPill tone="danger">Failed</StatusPill> : null}
      {item.responseType !== 'photo' && (editable || v.note) ? (
        <Textarea
          label={`Note for “${item.prompt}”`}
          value={v.note}
          disabled={!editable}
          onChange={(e) => onChange({ note: e.target.value })}
        />
      ) : null}
    </div>
  );
}

function SignDialog({
  missing,
  pending,
  error,
  onClose,
  onSign,
}: {
  missing: number;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onSign: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="Sign and submit"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || missing > 0 || pending}
            onClick={() => onSign(name.trim())}
          >
            {pending ? 'Submitting…' : 'Submit'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {missing > 0 ? (
          <Alert tone="warning">{missing} required item(s) still need an answer.</Alert>
        ) : null}
        <TextField label="Your name" value={name} onChange={(e) => setName(e.target.value)} />
        <ErrorAlert error={error} title="We couldn't submit the inspection" />
      </div>
    </Dialog>
  );
}
