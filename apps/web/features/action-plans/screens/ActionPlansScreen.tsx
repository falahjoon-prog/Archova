'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Select,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { ActionPlansIcon, Plus } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { formatLocalDate } from '@/shared/lib/format';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useActionPlanMutations, useActionPlans } from '../hooks/useActionPlans';
import { PLAN_STATUS_LABELS, SOURCE_LABELS, type ActionPlan, type PlanStatus } from '../lib/types';
import { ActionPlanDetailView } from './ActionPlanDetailView';
import { NewPlanDialog } from './dialogs';
import { PLAN_TONE } from './tones';

const STATUSES = Object.keys(PLAN_STATUS_LABELS) as PlanStatus[];

/** The action plans register. `?id=` opens one plan with its steps. */
export function ActionPlansScreen() {
  const [params, setParams] = useUrlState(['status', 'id'] as const);
  return params.id ? (
    <ActionPlanDetailView id={params.id} />
  ) : (
    <ActionPlanList status={params.status} setStatus={(v) => setParams({ status: v })} />
  );
}

function ActionPlanList({
  status: statusParam,
  setStatus,
}: {
  status: string | undefined;
  setStatus: (v: string) => void;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const status = STATUSES.includes(statusParam as PlanStatus)
    ? (statusParam as PlanStatus)
    : undefined;
  const list = useActionPlans({ status });
  const m = useActionPlanMutations();
  const [creating, setCreating] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'action-plans', id: 'register' },
  });

  const columns: DataTableColumn<ActionPlan>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (p) => p.numberLabel,
      cell: (p) => p.numberLabel,
    },
    {
      id: 'title',
      header: 'Action plan',
      cell: (p) => (
        <>
          <Link
            href={webRoutes.actionPlans(org.orgSlug, project.projectId, p.id)}
            aria-label={`Open ${p.numberLabel} ${p.title}`}
          >
            {p.title}
          </Link>
          {p.sourceType ? (
            <span className="u-caption"> · From {SOURCE_LABELS[p.sourceType].toLowerCase()}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'progress',
      header: 'Steps done',
      sortValue: (p) => (p.itemCount === 0 ? 0 : p.doneCount / p.itemCount),
      cell: (p) => `${p.doneCount} of ${p.itemCount}`,
    },
    {
      id: 'due',
      header: 'Due',
      sortValue: (p) => p.dueDate ?? '9999',
      cell: (p) =>
        p.dueDate ? (
          p.isOverdue ? (
            <StatusPill tone="danger">Overdue · {formatLocalDate(p.dueDate)}</StatusPill>
          ) : (
            formatLocalDate(p.dueDate)
          )
        ) : (
          '—'
        ),
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      cell: (p) => (
        <StatusPill tone={PLAN_TONE[p.status]}>{PLAN_STATUS_LABELS[p.status]}</StatusPill>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Action plans"
        description="Step-by-step plans with an owner and a due date for each step. Start one from a template or from an observation."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> New action plan
          </Button>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Action plans" /> : null}
      <FilterBar label="Filter action plans">
        <Select
          label="Status"
          value={statusParam}
          placeholder="Any status"
          options={STATUSES.map((v) => ({ value: v, label: PLAN_STATUS_LABELS[v] }))}
          onChange={(e) => setStatus(e.target.value)}
        />
      </FilterBar>
      <ErrorAlert error={list.error} title="We couldn't load action plans" />
      {list.isPending ? (
        <SkeletonRows label="Loading action plans…" />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState
          icon={ActionPlansIcon}
          title={status ? 'No action plans match' : 'No action plans yet'}
          description={
            status
              ? 'Try a different filter.'
              : 'Start one when a job needs several steps, each with someone responsible.'
          }
        />
      ) : (
        <DataTable
          caption="Action plans"
          columns={columns}
          rows={list.data ?? []}
          getRowId={(p) => p.id}
        />
      )}
      {creating ? (
        <NewPlanDialog
          pending={m.create.isPending}
          error={m.create.error}
          onClose={() => setCreating(false)}
          onSave={(input) => m.create.mutate(input, { onSuccess: () => setCreating(false) })}
        />
      ) : null}
    </>
  );
}
