'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { ChevronLeft, InspectionsIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { AssignDialog } from '../components/AssignDialog';
import { FlagPills } from '../components/FlagPills';
import { SubmissionPanel } from '../components/SubmissionPanel';
import { TemplateBuilderDialog } from '../components/TemplateBuilderDialog';
import {
  useFlaggedForms,
  useFormSubmission,
  useFormSubmissions,
  useFormTemplates,
  useMemberNames,
  useTemplateMutations,
} from '../hooks/useForms';
import {
  STATUS_LABELS,
  type FormSubmission,
  type FormTemplate,
  type SubmissionStatus,
} from '../lib/types';

const STATUSES = Object.keys(STATUS_LABELS) as SubmissionStatus[];
const KEYS = ['tab', 'id', 'status', 'flagged'] as const;

/** Custom forms: assign a form to someone, follow it to submission, and build the templates behind it. */
export function FormsScreen() {
  const project = useCurrentProject();
  const [url, setUrl] = useUrlState(KEYS);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'forms', id: url.id || 'register' },
  });
  if (url.id) return <OpenForm id={url.id} onBack={() => setUrl({ id: null })} />;

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Forms"
        description="Custom forms for anything the project needs recorded: safety walks, toolbox talks, handover checks, permits. Build a template, assign it, and follow it through."
      />
      <Tabs
        label="Forms"
        tabs={[
          { id: 'forms', label: 'Forms' },
          { id: 'templates', label: 'Templates' },
        ]}
        value={url.tab === 'templates' ? 'templates' : 'forms'}
        onValueChange={(t) => setUrl({ tab: t === 'forms' ? null : t })}
      >
        {url.tab === 'templates' ? (
          <TemplatesPanel />
        ) : (
          <SubmissionsPanel
            status={
              STATUSES.includes(url.status as SubmissionStatus)
                ? (url.status as SubmissionStatus)
                : undefined
            }
            flagged={url.flagged === 'true'}
            onFilter={(p) => setUrl(p)}
            onOpen={(id) => setUrl({ id })}
          />
        )}
      </Tabs>
    </>
  );
}

function OpenForm({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useFormSubmission(id);
  return (
    <>
      <PageHeader
        eyebrow="Forms"
        title={q.data?.submission.title ?? 'Form'}
        description={
          q.data
            ? `${q.data.submission.numberLabel} · ${q.data.submission.templateName} v${q.data.submission.templateVersion}`
            : undefined
        }
        actions={
          <Button variant="secondary" onClick={onBack}>
            <ChevronLeft size={16} aria-hidden="true" /> All forms
          </Button>
        }
      />
      <ErrorAlert error={q.error} title="We couldn't open this form" />
      {q.isPending ? (
        <SkeletonRows label="Loading form…" />
      ) : q.data ? (
        <SubmissionPanel detail={q.data} />
      ) : null}
    </>
  );
}

function SubmissionsPanel({
  status,
  flagged,
  onFilter,
  onOpen,
}: {
  status: SubmissionStatus | undefined;
  flagged: boolean;
  onFilter: (p: { status?: string | null; flagged?: string | null }) => void;
  onOpen: (id: string) => void;
}) {
  const templates = useFormTemplates();
  const list = useFormSubmissions({
    ...(status ? { status } : {}),
    ...(flagged ? { flagged: true } : {}),
  });
  const attention = useFlaggedForms();
  const names = useMemberNames();
  const [assigning, setAssigning] = useState(false);
  const who = useMemo(() => new Map((names.data ?? []).map((m) => [m.id, m.name])), [names.data]);
  const rows = list.data?.pages.flatMap((p) => p.data) ?? [];
  const published = (templates.data ?? []).filter((t) => t.status === 'published');
  // Outside users cannot list templates (404): they only see forms assigned to them, with no "Assign" button.
  const canAssign = published.length > 0;
  const needs = attention.data?.data ?? [];
  const overdue = needs.filter((s) => s.flags.includes('overdue')).length;

  const columns: DataTableColumn<FormSubmission>[] = [
    {
      id: 'no',
      header: 'No.',
      className: 'forms-nowrap',
      sortValue: (s) => s.number,
      cell: (s) => s.numberLabel,
    },
    {
      id: 'title',
      header: 'Form',
      rowHeader: true,
      sortValue: (s) => s.title,
      cell: (s) => (
        <Button variant="tertiary" className="forms-title" onClick={() => onOpen(s.id)}>
          {s.title}
        </Button>
      ),
    },
    {
      id: 'assignee',
      header: 'Assigned to',
      cell: (s) => (s.assigneeId ? (who.get(s.assigneeId) ?? 'Project member') : '—'),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <StatusPill
          tone={s.status === 'closed' ? 'success' : s.status === 'submitted' ? 'info' : 'neutral'}
        >
          {STATUS_LABELS[s.status]}
        </StatusPill>
      ),
    },
    {
      id: 'due',
      header: 'Due',
      className: 'forms-nowrap',
      sortValue: (s) => s.dueDate ?? '9999',
      cell: (s) => (s.dueDate ? s.dueDate : '—'),
    },
    {
      id: 'attention',
      header: 'Nova',
      cell: (s) =>
        s.flags.length > 0 ||
        (s.missingRequiredCount > 0 && (s.status === 'assigned' || s.status === 'in_progress')) ? (
          <span className="row-actions">
            <FlagPills flags={s.flags} daysLate={s.daysLate} />
            {s.missingRequiredCount > 0 &&
            (s.status === 'assigned' || s.status === 'in_progress') ? (
              <span>{s.missingRequiredCount} required left</span>
            ) : null}
          </span>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <div className="stack">
      {needs.length > 0 ? (
        <Alert
          tone="info"
          title="Nova"
          action={
            <Button
              variant="secondary"
              onClick={() => onFilter({ flagged: flagged ? null : 'true' })}
            >
              {flagged ? 'Show all forms' : 'Show these'}
            </Button>
          }
        >
          {needs.length} {needs.length === 1 ? 'form needs' : 'forms need'} attention
          {overdue > 0 ? `, ${overdue} overdue` : ''}. Open forms that are late, due within two
          days, or started and left for a week.
        </Alert>
      ) : null}
      <FilterBar
        label="Filter forms"
        actions={
          canAssign ? (
            <Button onClick={() => setAssigning(true)}>
              <Plus size={16} aria-hidden="true" /> Assign a form
            </Button>
          ) : undefined
        }
      >
        <Select
          label="Status"
          value={status ?? ''}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: STATUS_LABELS[v] }))}
          onChange={(e) => onFilter({ status: e.target.value || null })}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load forms" />
      {list.isPending ? (
        <SkeletonRows label="Loading forms…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title={status || flagged ? 'No forms match' : 'No forms yet'}
          description={
            status || flagged
              ? 'Try a different filter.'
              : 'Publish a template under Templates, then assign it to someone.'
          }
        />
      ) : (
        <DataTable caption="Forms" columns={columns} rows={rows} getRowId={(s) => s.id} />
      )}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </Button>
      ) : null}
      {assigning ? (
        <AssignDialog
          templates={published}
          onClose={() => setAssigning(false)}
          onAssigned={(id) => {
            setAssigning(false);
            onOpen(id);
          }}
        />
      ) : null}
    </div>
  );
}

function TemplatesPanel() {
  const list = useFormTemplates();
  const m = useTemplateMutations();
  const [editing, setEditing] = useState<FormTemplate | 'new' | null>(null);
  const rows = list.data ?? [];

  const columns: DataTableColumn<FormTemplate>[] = [
    { id: 'name', header: 'Form', rowHeader: true, sortValue: (t) => t.name, cell: (t) => t.name },
    { id: 'category', header: 'Category', cell: (t) => t.category ?? '—' },
    {
      id: 'fields',
      header: 'Fields',
      sortValue: (t) => t.fields.length,
      cell: (t) => `${t.fields.length} (${t.fields.filter((f) => f.required).length} required)`,
    },
    { id: 'version', header: 'Version', sortValue: (t) => t.version, cell: (t) => `v${t.version}` },
    {
      id: 'status',
      header: 'Status',
      cell: (t) => (
        <StatusPill tone={t.status === 'published' ? 'success' : 'neutral'}>
          {t.status === 'published' ? 'Published' : t.status === 'draft' ? 'Draft' : 'Archived'}
        </StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (t) => (
        <span className="row-actions">
          {t.status === 'draft' ? (
            <>
              <Button
                variant="tertiary"
                aria-label={`Edit ${t.name}`}
                onClick={() => setEditing(t)}
              >
                Edit
              </Button>
              <Button
                variant="tertiary"
                aria-label={`Publish ${t.name}`}
                disabled={m.publish.isPending}
                onClick={() => m.publish.mutate(t.id)}
              >
                Publish
              </Button>
            </>
          ) : (
            <Button
              variant="tertiary"
              aria-label={`New version of ${t.name}`}
              disabled={m.newVersion.isPending}
              onClick={() => m.newVersion.mutate(t.id)}
            >
              New version
            </Button>
          )}
          {t.status === 'published' ? (
            <Button
              variant="tertiary"
              aria-label={`Archive ${t.name}`}
              disabled={m.archive.isPending}
              onClick={() => m.archive.mutate(t.id)}
            >
              Archive
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="row-actions">
        <Button onClick={() => setEditing('new')}>
          <Plus size={16} aria-hidden="true" /> New template
        </Button>
        <span>A published template is frozen. Start a new version to change it.</span>
      </div>
      <ErrorAlert
        error={list.error ?? m.publish.error ?? m.newVersion.error ?? m.archive.error}
        title="Something went wrong with templates"
      />
      {list.isPending ? (
        <SkeletonRows label="Loading templates…" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={InspectionsIcon}
          title="No templates yet"
          description="Build one with sections and fields, publish it, then assign it."
        />
      ) : (
        <DataTable caption="Form templates" columns={columns} rows={rows} getRowId={(t) => t.id} />
      )}
      {editing ? (
        <TemplateBuilderDialog
          template={editing === 'new' ? null : editing}
          pending={m.create.isPending || m.update.isPending}
          error={m.create.error ?? m.update.error}
          onClose={() => setEditing(null)}
          onSave={(body) => {
            const done = { onSuccess: () => setEditing(null) };
            if (editing === 'new') m.create.mutate(body, done);
            else m.update.mutate({ id: editing.id, body }, done);
          }}
        />
      ) : null}
    </div>
  );
}
