'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  ItemHeader,
  PageHeader,
  SkeletonRows,
  StatusPill,
  buttonClassName,
  type DataTableColumn,
} from '@archova/ui';
import {
  ActionPlansIcon,
  Ban,
  Check,
  ChevronLeft,
  Copy,
  Plus,
  RotateCcw,
  Undo2,
} from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { useActionPlan, useActionPlanMutations } from '../hooks/useActionPlans';
import {
  PLAN_STATUS_LABELS,
  SOURCE_LABELS,
  STEP_STATUS_LABELS,
  type ActionStep,
} from '../lib/types';
import { AddStepDialog, NoteDialog, TemplateDialog } from './dialogs';
import { PLAN_TONE, STEP_TONE } from './tones';

type Dialogs = 'step' | 'template' | { done: ActionStep } | null;

/** One action plan: its header and the steps in order, each ticked off by whoever it is assigned to. */
export function ActionPlanDetailView({ id }: { id: string }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const q = useActionPlan(id);
  const m = useActionPlanMutations();
  const [dialog, setDialog] = useState<Dialogs>(null);
  usePublishAssistantScope({ projectId: project.projectId, record: { type: 'action-plan', id } });
  const d = q.data;

  const back = (
    <Link
      className={buttonClassName('secondary')}
      href={webRoutes.actionPlans(org.orgSlug, project.projectId)}
    >
      <ChevronLeft size={16} aria-hidden="true" /> Action plans
    </Link>
  );
  if (q.isPending) return <SkeletonRows label="Loading action plan…" />;
  if (!d) {
    return (
      <>
        <PageHeader eyebrow="Quality and safety" title="Action plan" actions={back} />
        <ErrorAlert error={q.error} title="We couldn't load this action plan" />
      </>
    );
  }
  const p = d.plan;
  const cancelled = p.status === 'cancelled';
  const setStatus = (stepId: string, status: ActionStep['status']) =>
    m.updateStep.mutate({ planId: p.id, stepId, patch: { status } });

  const columns: DataTableColumn<ActionStep>[] = [
    { id: 'sort', header: 'Step', rowHeader: true, cell: (s) => s.sort },
    {
      id: 'title',
      header: 'What needs doing',
      cell: (s) => (
        <>
          {s.title}
          {s.note ? <span className="u-caption"> · {s.note}</span> : null}
        </>
      ),
    },
    {
      id: 'who',
      header: 'Assigned to',
      cell: (s) => (s.assigneeCompanyId ? dir.companyName(s.assigneeCompanyId) : 'Not assigned'),
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (s) => s.dueDate ?? '9999',
      cell: (s) =>
        s.dueDate ? (
          s.isOverdue ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(s.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(s.dueDate)
          )
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (s) => (
        <StatusPill tone={STEP_TONE[s.status]}>{STEP_STATUS_LABELS[s.status]}</StatusPill>
      ),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (s) =>
        s.canUpdate && !cancelled ? (
          <span className="u-row">
            {s.status === 'open' ? (
              <>
                <Button
                  variant="tertiary"
                  aria-label={`Mark done: ${s.title}`}
                  onClick={() => setDialog({ done: s })}
                >
                  <Check size={16} aria-hidden="true" /> Done
                </Button>
                {d.canManage ? (
                  <Button
                    variant="tertiary"
                    aria-label={`Skip: ${s.title}`}
                    onClick={() => setStatus(s.id, 'skipped')}
                  >
                    Skip
                  </Button>
                ) : null}
              </>
            ) : (
              <Button
                variant="tertiary"
                aria-label={`Reopen: ${s.title}`}
                onClick={() => setStatus(s.id, 'open')}
              >
                <Undo2 size={16} aria-hidden="true" /> Reopen
              </Button>
            )}
          </span>
        ) : null,
    },
  ];

  return (
    <>
      <p className="u-m-0" style={{ marginBottom: 'var(--space-4)' }}>
        {back}
      </p>
      <ItemHeader
        number={p.numberLabel}
        title={p.title}
        status={<StatusPill tone={PLAN_TONE[p.status]}>{PLAN_STATUS_LABELS[p.status]}</StatusPill>}
        due={p.dueDate ? `Due ${formatLocalDate(p.dueDate)}` : undefined}
        meta={
          <>
            <span>
              {p.doneCount} of {p.itemCount} steps done
            </span>
            {p.isOverdue ? <StatusPill tone="danger">Overdue</StatusPill> : null}
          </>
        }
        actions={
          d.canManage ? (
            <>
              <Button variant="secondary" onClick={() => setDialog('template')}>
                <Copy size={16} aria-hidden="true" /> Save as template
              </Button>
              {cancelled ? (
                <Button
                  disabled={m.update.isPending}
                  onClick={() => m.update.mutate({ detail: d, patch: { status: 'active' } })}
                >
                  <RotateCcw size={16} aria-hidden="true" /> Reopen plan
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    disabled={m.update.isPending}
                    onClick={() => m.update.mutate({ detail: d, patch: { status: 'cancelled' } })}
                  >
                    <Ban size={16} aria-hidden="true" /> Cancel plan
                  </Button>
                  <Button onClick={() => setDialog('step')}>
                    <Plus size={16} aria-hidden="true" /> Add step
                  </Button>
                </>
              )}
            </>
          ) : null
        }
      />
      <ErrorAlert
        error={m.update.error ?? m.updateStep.error}
        title="We couldn't update the plan"
      />
      {p.description || p.sourceType ? (
        <Card title="About this plan">
          <div className="stack">
            {p.description ? <p className="u-m-0">{p.description}</p> : null}
            {p.sourceType ? (
              <p className="u-m-0 u-caption">
                Raised from an {SOURCE_LABELS[p.sourceType].toLowerCase()}.
              </p>
            ) : null}
          </div>
        </Card>
      ) : null}
      {d.items.length === 0 ? (
        <EmptyState
          icon={ActionPlansIcon}
          title="No steps yet"
          description={
            d.canManage ? 'Add the first step to get this plan moving.' : 'Nothing to do yet.'
          }
        />
      ) : (
        <DataTable caption="Steps" columns={columns} rows={d.items} getRowId={(s) => s.id} />
      )}

      {dialog === 'step' ? (
        <AddStepDialog
          dir={dir}
          pending={m.addStep.isPending}
          error={m.addStep.error}
          onClose={() => setDialog(null)}
          onSave={(input) =>
            m.addStep.mutate({ planId: p.id, input }, { onSuccess: () => setDialog(null) })
          }
        />
      ) : null}
      {dialog === 'template' ? (
        <TemplateDialog
          defaultName={p.title}
          pending={m.saveAsTemplate.isPending}
          error={m.saveAsTemplate.error}
          onClose={() => setDialog(null)}
          onSave={(name) =>
            m.saveAsTemplate.mutate({ planId: p.id, name }, { onSuccess: () => setDialog(null) })
          }
        />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <NoteDialog
          title={`Mark done: ${dialog.done.title}`}
          pending={m.updateStep.isPending}
          error={m.updateStep.error}
          onClose={() => setDialog(null)}
          onSave={(note) =>
            m.updateStep.mutate(
              {
                planId: p.id,
                stepId: dialog.done.id,
                patch: { status: 'done', ...(note ? { note } : {}) },
              },
              { onSuccess: () => setDialog(null) },
            )
          }
        />
      ) : null}
    </>
  );
}
