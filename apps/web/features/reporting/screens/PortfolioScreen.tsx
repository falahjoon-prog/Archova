'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Checkbox,
  DataTable,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { HomeIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { formatMoney } from '@/shared/lib/format';
import { useBranding } from '@/features/branding';
import { usePortfolio } from '../hooks/useReporting';
import type { PortfolioBudget, PortfolioProject, PortfolioTool } from '../lib/types';

/** "4 open" with a red "2 overdue" beside it; "No access" when the caller cannot open that tool on the project. */
function ToolCell({ tool }: { tool: PortfolioTool }) {
  if (tool.restricted) return <span className="u-muted">No access</span>;
  return (
    <>
      {tool.open}
      {tool.overdue > 0 ? (
        <>
          {' '}
          <StatusPill tone="danger">{tool.overdue} overdue</StatusPill>
        </>
      ) : null}
    </>
  );
}

/** One tile: the open count, with the overdue count underneath and the tile turning red only when something is overdue. */
function stat(label: string, open: number, overdue: number, word: string) {
  return {
    label,
    value: open,
    hint: `${overdue} ${word}`,
    tone: overdue > 0 ? ('danger' as const) : undefined,
  };
}

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

/** Forecast final cost against the revised budget: the shortfall in red when over, the headroom when under. */
function BudgetCell({ budget }: { budget: PortfolioBudget }) {
  if (budget.restricted) return <span className="u-muted">No access</span>;
  if (!budget.hasBudget) return <span className="u-muted">No budget</span>;
  const over = budget.variance.startsWith('-');
  return (
    <>
      <div>{over ? aud(budget.variance.slice(1)) : aud(budget.variance)}</div>
      <StatusPill tone={over ? 'danger' : 'success'}>
        {over ? 'over budget' : 'under budget'}
      </StatusPill>
    </>
  );
}

const DEFAULT_TILES = [
  'projects',
  'rfis',
  'defects',
  'submittals',
  'claims',
  'variations',
  'incidents',
  'programme',
  'budget',
];

type Totals = NonNullable<ReturnType<typeof usePortfolio>['data']>['totals'];

/** Each tile the company can switch on or off in Settings → Branding, by widget key. */
function tileFor(key: string, t: Totals) {
  switch (key) {
    case 'projects':
      return { label: 'Projects', value: t.projects };
    case 'rfis':
      return stat('RFIs open', t.rfisOpen, t.rfisOverdue, 'overdue');
    case 'defects':
      return stat('Defects open', t.defectsOpen, t.defectsOverdue, 'overdue');
    case 'submittals':
      return stat('Submittals with reviewers', t.submittalsOpen, t.submittalsOverdue, 'overdue');
    case 'claims':
      return stat('Claims unpaid', t.claimsOpen, t.claimsOverdue, 'overdue');
    case 'variations':
      return { label: 'Variations to decide', value: t.variationsOpen };
    case 'incidents':
      return stat('Incidents open', t.incidentsOpen, t.incidentsOverdue, 'to notify');
    case 'programme':
      return stat('Programme activities open', t.programmeOpen, t.programmeOverdue, 'late');
    case 'budget':
      return t.budgetProjects > 0
        ? {
            label: 'Forecast vs budget',
            value: aud(t.budgetVariance.replace('-', '')),
            tone: t.projectsOverBudget > 0 ? ('danger' as const) : undefined,
            hint: `${t.budgetVariance.startsWith('-') ? 'over' : 'under'} across ${t.budgetProjects} ${t.budgetProjects === 1 ? 'project' : 'projects'} (${t.projectsOverBudget} over budget)`,
          }
        : null;
    default:
      return null;
  }
}

/** Every project in the company at a glance: what is open and what is overdue, most overdue first. */
export function PortfolioScreen() {
  const org = useCurrentOrg();
  const [includeClosed, setIncludeClosed] = useState(false);
  const portfolio = usePortfolio(includeClosed);
  const data = portfolio.data;
  // The company picks which widgets show and in what order (Settings → Branding); all show until it does.
  const widgets = useBranding().data?.dashboardWidgets;
  const show = (key: string) => !widgets || widgets.includes(key);
  const tiles = data
    ? (widgets ?? DEFAULT_TILES).flatMap((k) => {
        const tile = k === 'project_table' ? null : tileFor(k, data.totals);
        return tile ? [tile] : [];
      })
    : [];

  const columns: DataTableColumn<PortfolioProject>[] = [
    {
      id: 'project',
      header: 'Project',
      rowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <Link className="link" href={webRoutes.project(org.orgSlug, r.id)}>
          {r.name}
        </Link>
      ),
    },
    {
      id: 'rfis',
      header: 'RFIs',
      sortValue: (r) => r.rfis.open,
      cell: (r) => <ToolCell tool={r.rfis} />,
    },
    {
      id: 'defects',
      header: 'Defects',
      sortValue: (r) => r.defects.open,
      cell: (r) => <ToolCell tool={r.defects} />,
    },
    {
      id: 'submittals',
      header: 'Submittals',
      sortValue: (r) => r.submittals.open,
      cell: (r) => <ToolCell tool={r.submittals} />,
    },
    {
      id: 'claims',
      header: 'Claims',
      sortValue: (r) => r.claims.open,
      cell: (r) => <ToolCell tool={r.claims} />,
    },
    {
      id: 'variations',
      header: 'Variations',
      sortValue: (r) => r.variations.open,
      cell: (r) => <ToolCell tool={r.variations} />,
    },
    {
      id: 'incidents',
      header: 'Incidents',
      sortValue: (r) => r.incidents.open,
      cell: (r) => <ToolCell tool={r.incidents} />,
    },
    {
      id: 'programme',
      header: 'Programme',
      sortValue: (r) => r.programme.open,
      cell: (r) => <ToolCell tool={r.programme} />,
    },
    {
      id: 'budget',
      header: 'Forecast vs budget',
      sortValue: (r) =>
        r.budget.hasBudget && !r.budget.restricted ? Number(r.budget.variance) : 0,
      cell: (r) => <BudgetCell budget={r.budget} />,
    },
    {
      id: 'attention',
      header: 'Overdue',
      align: 'end',
      sortValue: (r) => r.attention,
      cell: (r) => r.attention || '—',
    },
  ];

  return (
    <div className="stack-lg">
      <PageHeader
        eyebrow="Company"
        title="Portfolio"
        description="Open items on every project you can see, with what is overdue in red. Counts only include what you are allowed to open on each project."
      />
      <ErrorAlert error={portfolio.error} title="We couldn't load the portfolio" />
      {data && tiles.length > 0 ? <StatGrid items={tiles} /> : null}
      {data?.truncated ? (
        <Alert tone="info" title="Showing the first 200 projects">
          Close out finished projects to bring the rest into view.
        </Alert>
      ) : null}
      {show('project_table') ? (
        <>
          <Checkbox
            label="Include closed and archived projects"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          {portfolio.isPending ? (
            <SkeletonRows label="Loading the portfolio…" />
          ) : (
            <DataTable
              caption="Projects with open and overdue items"
              columns={columns}
              rows={data?.projects ?? []}
              getRowId={(r) => r.id}
              defaultSort={{ columnId: 'attention', direction: 'desc' }}
              empty={
                <EmptyState
                  icon={HomeIcon}
                  title="No projects yet"
                  description="Projects you can see appear here with their open and overdue items."
                />
              }
            />
          )}
        </>
      ) : null}
    </div>
  );
}
