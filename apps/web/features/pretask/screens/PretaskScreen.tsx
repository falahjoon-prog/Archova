'use client';

import Link from 'next/link';
import { useState } from 'react';
import { webRoutes } from '@archova/routes';
import {
  Button,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  Tabs,
  type DataTableColumn,
} from '@archova/ui';
import { Plus, PretaskIcon } from '@archova/ui/icons';
import { usePublishAssistantScope } from '@/features/assistant';
import { useUrlState } from '@/shared/hooks/useUrlState';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { PreviewDataNotice } from '@/shared/layout/PreviewDataNotice';
import { previewDataOnly } from '@/shared/lib/data-mode';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { useCurrentProject } from '@/shared/providers/CurrentProjectProvider';
import { useProjectDirectory } from '@/shared/providers/useProjectDirectory';
import { usePlanList, usePretaskMutations } from '../hooks/usePretask';
import { STATUS_LABELS, type Plan } from '../lib/types';
import { PretaskDetailView } from './PretaskDetailView';
import { NewPlanDialog } from './dialogs';

/** Pre-task plans. `?id=` opens one plan with its hazards, crew sign-on and record trail. */
export function PretaskScreen() {
  const [params, setParams] = useUrlState(['id', 'view'] as const);
  return params.id ? (
    <PretaskDetailView id={params.id} />
  ) : (
    <PretaskHome
      view={params.view === 'review' ? 'review' : 'all'}
      setView={(v) => setParams({ view: v === 'all' ? null : v })}
    />
  );
}

const needsReview = (p: Plan) => p.status === 'closed' && !p.reviewedAt;

function PretaskHome({
  view,
  setView,
}: {
  view: 'all' | 'review';
  setView: (v: 'all' | 'review') => void;
}) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const plans = usePlanList();
  const m = usePretaskMutations();
  const [creating, setCreating] = useState(false);
  usePublishAssistantScope({
    projectId: project.projectId,
    record: { type: 'pretask', id: 'register' },
  });
  const all = plans.data ?? [];
  const queue = all.filter(needsReview);
  const rows = view === 'review' ? queue : all;

  const columns: DataTableColumn<Plan>[] = [
    {
      id: 'number',
      header: 'No.',
      rowHeader: true,
      sortValue: (p) => p.numberLabel,
      cell: (p) => (
        <Link
          href={webRoutes.pretaskPlans(org.orgSlug, project.projectId, p.id)}
          aria-label={`${p.numberLabel} ${p.taskTitle}`}
        >
          {p.numberLabel}
        </Link>
      ),
    },
    { id: 'task', header: 'Task', sortValue: (p) => p.taskTitle, cell: (p) => p.taskTitle },
    { id: 'date', header: 'Work date', sortValue: (p) => p.workDate, cell: (p) => p.workDate },
    {
      id: 'by',
      header: 'Supervisor',
      sortValue: (p) => p.supervisorName,
      cell: (p) => p.supervisorName,
    },
    {
      id: 'signed',
      header: 'Signed on',
      sortValue: (p) => p.signedCount,
      cell: (p) => `${p.signedCount} of ${p.crewCount}`,
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (p) => p.status,
      cell: (p) =>
        p.reviewedAt ? (
          <StatusPill tone="success">Reviewed</StatusPill>
        ) : p.status === 'closed' ? (
          <StatusPill tone="warning">To review</StatusPill>
        ) : (
          <StatusPill tone="info">{STATUS_LABELS[p.status]}</StatusPill>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Quality and safety"
        title="Pre-task plans"
        description="Before each task: the hazards, the controls and who is doing the work. Everyone signs on, and the supervisor reviews the record. Nova suggests hazards that keep coming up."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" /> New plan
          </Button>
        }
      />
      {previewDataOnly ? <PreviewDataNotice tool="Pre-task plans" /> : null}
      <Tabs
        label="Pre-task plan views"
        tabs={[
          { id: 'all', label: 'All plans', count: all.length },
          { id: 'review', label: 'To review', count: queue.length },
        ]}
        value={view}
        onValueChange={(v) => setView(v as 'all' | 'review')}
      >
        <div className="stack">
          <ErrorAlert error={plans.error} title="We couldn't load pre-task plans" />
          {plans.isPending ? (
            <SkeletonRows label="Loading pre-task plans…" />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={PretaskIcon}
              title={view === 'review' ? 'Nothing waiting for review' : 'No pre-task plans yet'}
              description={
                view === 'review'
                  ? 'Closed plans appear here until a supervisor reviews them.'
                  : 'Start one before a task begins. The crew signs on once the hazards and controls are listed.'
              }
            />
          ) : (
            <DataTable
              caption="Pre-task plans"
              columns={columns}
              rows={rows}
              getRowId={(p) => p.id}
            />
          )}
        </div>
      </Tabs>
      {creating ? (
        <NewPlanDialog
          companies={dir.companies.map((c) => ({ id: c.id, name: c.name }))}
          timeZone={project.timezone}
          supervisor=""
          pending={m.createPlan.isPending}
          error={m.createPlan.error}
          onClose={() => setCreating(false)}
          onSave={(input) => m.createPlan.mutate(input, { onSuccess: () => setCreating(false) })}
        />
      ) : null}
    </>
  );
}
