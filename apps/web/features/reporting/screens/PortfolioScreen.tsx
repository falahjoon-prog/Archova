'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Checkbox,
  DataTable,
  DescriptionList,
  EmptyState,
  PageHeader,
  SkeletonRows,
  StatusPill,
  type DataTableColumn,
} from '@archova/ui';
import { HomeIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { useCurrentOrg } from '@/shared/providers/CurrentOrgProvider';
import { formatMoney } from '@/shared/lib/format';
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

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

/** Forecast final cost against the revised budget: the shortfall in red when over, the headroom when under. */
function BudgetCell({ budget }: { budget: PortfolioBudget }) {
  if (budget.restricted) return <span className="u-muted">No access</span>;
  if (!budget.hasBudget) return <span className="u-muted">No budget</span>;
  const over = budget.variance.startsWith('-');
  return (
    <>
      {over ? aud(budget.variance.slice(1)) : aud(budget.variance)}{' '}
      <StatusPill tone={over ? 'danger' : 'success'}>
        {over ? 'over budget' : 'under budget'}
      </StatusPill>
    </>
  );
}

/** Every project in the company at a glance: what is open and what is overdue, most overdue first. */
export function PortfolioScreen() {
  const org = useCurrentOrg();
  const [includeClosed, setIncludeClosed] = useState(false);
  const portfolio = usePortfolio(includeClosed);
  const data = portfolio.data;

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
      header: 'RFIs open',
      sortValue: (r) => r.rfis.open,
      cell: (r) => <ToolCell tool={r.rfis} />,
    },
    {
      id: 'defects',
      header: 'Defects open',
      sortValue: (r) => r.defects.open,
      cell: (r) => <ToolCell tool={r.defects} />,
    },
    {
      id: 'submittals',
      header: 'Submittals with reviewers',
      sortValue: (r) => r.submittals.open,
      cell: (r) => <ToolCell tool={r.submittals} />,
    },
    {
      id: 'claims',
      header: 'Claims unpaid',
      sortValue: (r) => r.claims.open,
      cell: (r) => <ToolCell tool={r.claims} />,
    },
    {
      id: 'variations',
      header: 'Variations to decide',
      sortValue: (r) => r.variations.open,
      cell: (r) => <ToolCell tool={r.variations} />,
    },
    {
      id: 'incidents',
      header: 'Incidents open',
      sortValue: (r) => r.incidents.open,
      cell: (r) => <ToolCell tool={r.incidents} />,
    },
    {
      id: 'programme',
      header: 'Programme activities open',
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
        description="What is open and what is overdue on every project you can see. Counts only include what you are allowed to open on each project."
      />
      <ErrorAlert error={portfolio.error} title="We couldn't load the portfolio" />
      {data ? (
        <DescriptionList
          items={[
            { label: 'Projects', value: data.totals.projects },
            {
              label: 'RFIs open',
              value: `${data.totals.rfisOpen} (${data.totals.rfisOverdue} overdue)`,
            },
            {
              label: 'Defects open',
              value: `${data.totals.defectsOpen} (${data.totals.defectsOverdue} overdue)`,
            },
            {
              label: 'Submittals with reviewers',
              value: `${data.totals.submittalsOpen} (${data.totals.submittalsOverdue} overdue)`,
            },
            {
              label: 'Claims unpaid',
              value: `${data.totals.claimsOpen} (${data.totals.claimsOverdue} overdue)`,
            },
            {
              label: 'Variations to decide',
              value: String(data.totals.variationsOpen),
            },
            {
              label: 'Incidents open',
              value: `${data.totals.incidentsOpen} (${data.totals.incidentsOverdue} to notify)`,
            },
            {
              label: 'Programme activities open',
              value: `${data.totals.programmeOpen} (${data.totals.programmeOverdue} late)`,
            },
            ...(data.totals.budgetProjects > 0
              ? [
                  {
                    label: 'Forecast vs budget',
                    value: `${aud(data.totals.budgetVariance.replace('-', ''))} ${
                      data.totals.budgetVariance.startsWith('-') ? 'over' : 'under'
                    } across ${data.totals.budgetProjects} projects (${data.totals.projectsOverBudget} over budget)`,
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {data?.truncated ? (
        <Alert tone="info" title="Showing the first 200 projects">
          Close out finished projects to bring the rest into view.
        </Alert>
      ) : null}
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
    </div>
  );
}
