'use client';

import Link from 'next/link';
import {
  DataTable,
  EmptyState,
  Select,
  SkeletonRows,
  StatGrid,
  StatusPill,
  type DataTableColumn,
  type StatItem,
} from '@archova/ui';
import { HomeIcon } from '@archova/ui/icons';
import { webRoutes } from '@archova/routes';
import {
  registerTile,
  type TileCategory,
  type TileContext,
  type TileProps,
} from '@/features/dashboard';
import { formatMoney } from '@/shared/lib/format';
import type { Portfolio, PortfolioBudget, PortfolioProject, PortfolioTool } from './lib/types';

/** The Portfolio's tiles: one stat per module, a Big Number for any metric, and the projects table. */

const aud = (amount: string) => formatMoney({ amount, currency: 'AUD' });

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

/** One tile: the open count, with the overdue count underneath and the tile turning red only when something is overdue. */
function stat(label: string, open: number, overdue: number, word: string): StatItem {
  return {
    label,
    value: open,
    hint: `${overdue} ${word}`,
    tone: overdue > 0 ? 'danger' : undefined,
  };
}

type Totals = Portfolio['totals'];

const STATS: Record<string, (t: Totals) => StatItem | null> = {
  projects: (t) => ({ label: 'Projects', value: t.projects }),
  rfis: (t) => stat('RFIs open', t.rfisOpen, t.rfisOverdue, 'overdue'),
  defects: (t) => stat('Defects open', t.defectsOpen, t.defectsOverdue, 'overdue'),
  submittals: (t) =>
    stat('Submittals with reviewers', t.submittalsOpen, t.submittalsOverdue, 'overdue'),
  claims: (t) => stat('Claims unpaid', t.claimsOpen, t.claimsOverdue, 'overdue'),
  variations: (t) => ({ label: 'Variations to decide', value: t.variationsOpen }),
  incidents: (t) => stat('Incidents open', t.incidentsOpen, t.incidentsOverdue, 'to notify'),
  programme: (t) => stat('Programme activities open', t.programmeOpen, t.programmeOverdue, 'late'),
  budget: (t) =>
    t.budgetProjects > 0
      ? {
          label: 'Forecast vs budget',
          value: aud(t.budgetVariance.replace('-', '')),
          tone: t.projectsOverBudget > 0 ? 'danger' : undefined,
          hint: `${t.budgetVariance.startsWith('-') ? 'over' : 'under'} across ${t.budgetProjects} ${t.budgetProjects === 1 ? 'project' : 'projects'} (${t.projectsOverBudget} over budget)`,
        }
      : null,
};

const portfolio = (ctx: TileContext) => ctx.data as Portfolio | undefined;

function StatTile({ stat: key, ...p }: TileProps & { stat: string }) {
  const data = portfolio(p.ctx);
  if (!data) return <SkeletonRows label="Loading…" />;
  const item = STATS[key]!(data.totals);
  return item ? (
    <StatGrid items={[item]} />
  ) : (
    <p className="dash-text u-muted">No budgets set up yet.</p>
  );
}

const STAT_TILES: ReadonlyArray<[string, string, string, TileCategory]> = [
  ['projects', 'Projects', 'How many projects you can see.', 'project_information'],
  ['rfis', 'RFIs open', 'Open RFIs, with how many are overdue.', 'tasks_actions'],
  ['defects', 'Defects open', 'Open defects, with how many are overdue.', 'tasks_actions'],
  ['submittals', 'Submittals with reviewers', 'Submittals out for review.', 'tasks_actions'],
  ['claims', 'Claims unpaid', 'Payment claims not yet paid.', 'cost'],
  ['variations', 'Variations to decide', 'Variations waiting on a decision.', 'cost'],
  ['incidents', 'Incidents open', 'Open incidents and any still to notify.', 'risk'],
  [
    'programme',
    'Programme activities open',
    'Open programme activities and late ones.',
    'schedule',
  ],
  ['budget', 'Forecast vs budget', 'Forecast final cost against budget, across projects.', 'cost'],
];
for (const [key, title, description, category] of STAT_TILES)
  registerTile({
    type: `stat_${key}`,
    title,
    description,
    category,
    surfaces: ['portfolio'],
    size: { w: 3, h: 2 },
    min: { w: 2, h: 2 },
    render: (p) => <StatTile stat={key} {...p} />,
  });

const METRICS: ReadonlyArray<{ key: string; label: string; value: (t: Totals) => string }> = [
  { key: 'projects', label: 'Projects', value: (t) => String(t.projects) },
  { key: 'rfisOpen', label: 'RFIs open', value: (t) => String(t.rfisOpen) },
  { key: 'rfisOverdue', label: 'RFIs overdue', value: (t) => String(t.rfisOverdue) },
  { key: 'defectsOpen', label: 'Defects open', value: (t) => String(t.defectsOpen) },
  { key: 'defectsOverdue', label: 'Defects overdue', value: (t) => String(t.defectsOverdue) },
  { key: 'claimsOpen', label: 'Claims unpaid', value: (t) => String(t.claimsOpen) },
  { key: 'variationsOpen', label: 'Variations to decide', value: (t) => String(t.variationsOpen) },
  { key: 'incidentsOpen', label: 'Incidents open', value: (t) => String(t.incidentsOpen) },
  {
    key: 'programmeOverdue',
    label: 'Programme activities late',
    value: (t) => String(t.programmeOverdue),
  },
  {
    key: 'budgetVariance',
    label: 'Forecast vs budget',
    value: (t) => aud(t.budgetVariance.replace('-', '')),
  },
];

registerTile({
  type: 'big_number',
  title: 'Big number',
  description: 'Call out any one figure, such as open RFIs, in big text.',
  category: 'project_information',
  surfaces: ['portfolio'],
  size: { w: 3, h: 3 },
  config: { metric: 'rfisOpen' },
  render: ({ config, ctx }) => {
    const data = portfolio(ctx);
    const m = METRICS.find((x) => x.key === config.metric) ?? METRICS[1]!;
    if (!data) return <SkeletonRows label="Loading…" />;
    return (
      <div className="dash-big">
        <span className="dash-big__label">{m.label}</span>
        <span className="dash-big__value">{m.value(data.totals)}</span>
      </div>
    );
  },
  Settings: ({ config, onChange }) => (
    <Select
      label="Figure"
      value={typeof config.metric === 'string' ? config.metric : 'rfisOpen'}
      options={METRICS.map((m) => ({ value: m.key, label: m.label }))}
      onChange={(e) => onChange({ ...config, metric: e.target.value })}
    />
  ),
});

function ProjectsTable({ ctx }: TileProps) {
  const data = portfolio(ctx);
  if (!data) return <SkeletonRows label="Loading the portfolio…" />;
  const columns: DataTableColumn<PortfolioProject>[] = [
    {
      id: 'project',
      header: 'Project',
      rowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) =>
        ctx.preview ? (
          r.name
        ) : (
          <Link className="link" href={webRoutes.project(ctx.orgSlug, r.id)}>
            {r.name}
          </Link>
        ),
    },
    ...(
      [
        ['rfis', 'RFIs'],
        ['defects', 'Defects'],
        ['submittals', 'Submittals'],
        ['claims', 'Claims'],
        ['variations', 'Variations'],
        ['incidents', 'Incidents'],
        ['programme', 'Programme'],
      ] as const
    ).map(([id, header]): DataTableColumn<PortfolioProject> => ({
      id,
      header,
      sortValue: (r) => r[id].open,
      cell: (r) => <ToolCell tool={r[id]} />,
    })),
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
    <DataTable
      caption="Projects with open and overdue items"
      columns={columns}
      rows={data.projects}
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
  );
}

registerTile({
  type: 'projects_table',
  title: 'Projects table',
  description: 'Every project with what is open and overdue, most overdue first.',
  category: 'project_information',
  surfaces: ['portfolio'],
  size: { w: 12, h: 8 },
  min: { w: 6, h: 4 },
  render: ProjectsTable,
});

/** What the library previews show. */
export const SAMPLE_PORTFOLIO: Portfolio = {
  totals: {
    projects: 3,
    rfisOpen: 12,
    rfisOverdue: 2,
    defectsOpen: 24,
    defectsOverdue: 5,
    submittalsOpen: 7,
    submittalsOverdue: 1,
    claimsOpen: 4,
    claimsOverdue: 1,
    variationsOpen: 6,
    variationsOverdue: 0,
    incidentsOpen: 2,
    incidentsOverdue: 0,
    programmeOpen: 38,
    programmeOverdue: 3,
    budgetProjects: 3,
    projectsOverBudget: 1,
    budgetRevised: '4200000.00',
    budgetForecastFinal: '4100000.00',
    budgetVariance: '100000.00',
  },
  projects: [],
  truncated: false,
} as Portfolio;
