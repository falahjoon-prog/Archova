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
import { useInsights, usePlanList, usePretaskMutations, useTemplates } from '../hooks/usePretask';
import { STATUS_LABELS, type Insights, type Plan, type Template } from '../lib/types';
import { PretaskDetailView } from './PretaskDetailView';
import { NewPlanDialog } from './dialogs';

/** Pre-task plans. `?id=` opens one plan with its hazards, crew sign-on and record trail. */
export function PretaskScreen() {
  const [params, setParams] = useUrlState(['id', 'view'] as const);
  return params.id ? (
    <PretaskDetailView id={params.id} />
  ) : (
    <PretaskHome
      view={VIEWS.includes(params.view as View) ? (params.view as View) : 'all'}
      setView={(v) => setParams({ view: v === 'all' ? null : v })}
    />
  );
}

type View = 'all' | 'review' | 'templates' | 'insights';
const VIEWS: View[] = ['all', 'review', 'templates', 'insights'];

const needsReview = (p: Plan) => p.status === 'closed' && !p.reviewedAt;

function PretaskHome({ view, setView }: { view: View; setView: (v: View) => void }) {
  const org = useCurrentOrg();
  const project = useCurrentProject();
  const dir = useProjectDirectory();
  const plans = usePlanList();
  const m = usePretaskMutations();
  const templates = useTemplates();
  const insights = useInsights();
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
          { id: 'templates', label: 'Templates', count: (templates.data ?? []).length },
          ...(insights.data ? [{ id: 'insights', label: 'Insights' }] : []),
        ]}
        value={view}
        onValueChange={(v) => setView(v as View)}
      >
        <div className="stack">
          <ErrorAlert error={plans.error} title="We couldn't load pre-task plans" />
          {view === 'templates' ? (
            <TemplatesTable
              templates={templates.data ?? []}
              onToggle={(t) => m.setTemplateActive.mutate({ template: t, isActive: !t.isActive })}
            />
          ) : view === 'insights' && insights.data ? (
            <InsightsPanel data={insights.data} companyName={dir.companyName} />
          ) : plans.isPending ? (
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

function TemplatesTable({
  templates,
  onToggle,
}: {
  templates: Template[];
  onToggle: (t: Template) => void;
}) {
  if (templates.length === 0) {
    return (
      <EmptyState
        icon={PretaskIcon}
        title="No templates yet"
        description="Open a plan and choose Save as template. New plans can then start from its task, SWMS and hazards."
      />
    );
  }
  const columns: DataTableColumn<Template>[] = [
    { id: 'name', header: 'Template', rowHeader: true, cell: (t) => t.name },
    { id: 'task', header: 'Task', cell: (t) => t.taskTitle },
    { id: 'hazards', header: 'Hazards', cell: (t) => String(t.hazards.length) },
    {
      id: 'state',
      header: 'State',
      cell: (t) => (
        <StatusPill tone={t.isActive ? 'success' : 'neutral'}>
          {t.isActive ? 'In use' : 'Retired'}
        </StatusPill>
      ),
    },
    {
      id: 'action',
      header: <span className="sr-only">Actions</span>,
      cell: (t) => (
        <Button variant="secondary" onClick={() => onToggle(t)}>
          {t.isActive ? 'Retire' : 'Restore'}
        </Button>
      ),
    },
  ];
  return (
    <DataTable
      caption="Pre-task plan templates"
      columns={columns}
      rows={templates}
      getRowId={(t) => t.id}
    />
  );
}

function InsightsPanel({
  data,
  companyName,
}: {
  data: Insights;
  companyName: (id: string) => string;
}) {
  const hazardColumns: DataTableColumn<Insights['topHazards'][number]>[] = [
    { id: 'hazard', header: 'Hazard', rowHeader: true, cell: (h) => h.hazard },
    { id: 'plans', header: 'Plans', sortValue: (h) => h.plans, cell: (h) => String(h.plans) },
    {
      id: 'high',
      header: 'High risk',
      sortValue: (h) => h.highRiskPlans,
      cell: (h) => String(h.highRiskPlans),
    },
    { id: 'last', header: 'Last seen', cell: (h) => h.lastSeen },
  ];
  const companyColumns: DataTableColumn<Insights['byCompany'][number]>[] = [
    {
      id: 'company',
      header: 'Company',
      rowHeader: true,
      cell: (c) => (c.companyId ? companyName(c.companyId) : 'Not recorded'),
    },
    { id: 'plans', header: 'Plans', sortValue: (c) => c.plans, cell: (c) => String(c.plans) },
    { id: 'closed', header: 'Closed', cell: (c) => String(c.closed) },
    { id: 'high', header: 'High-risk hazards', cell: (c) => String(c.highRiskHazards) },
  ];
  return (
    <div className="stack">
      <p className="u-muted u-m-0">
        Last {data.days} days: {data.plans} plans, {data.closed} closed, {data.reviewed} reviewed,{' '}
        {data.toReview} waiting for review.
      </p>
      {data.topHazards.length ? (
        <DataTable
          caption="Hazards that keep coming up"
          columns={hazardColumns}
          rows={data.topHazards}
          getRowId={(h) => h.hazard}
        />
      ) : (
        <EmptyState
          icon={PretaskIcon}
          title="No hazards recorded yet"
          description="Once plans are started, the hazards that recur show up here."
        />
      )}
      {data.byCompany.length ? (
        <DataTable
          caption="Plans by company"
          columns={companyColumns}
          rows={data.byCompany}
          getRowId={(c) => c.companyId ?? 'none'}
        />
      ) : null}
    </div>
  );
}
