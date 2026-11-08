// Report builder and portfolio rules. Pure, no IO.

export const REPORT_SOURCES = [
  'rfis',
  'defects',
  'submittals',
  'claims',
  'variations',
  'incidents',
  'programme',
] as const;
export type ReportSource = (typeof REPORT_SOURCES)[number];

export const REPORT_STATES = ['open', 'closed', 'all'] as const;
export type ReportState = (typeof REPORT_STATES)[number];

/** In display order; a saved report always shows its columns in this order. */
export const REPORT_COLUMNS = [
  'project',
  'ref',
  'title',
  'status',
  'dueDate',
  'overdue',
  'createdAt',
] as const;
export type ReportColumn = (typeof REPORT_COLUMNS)[number];

/** `projectIds` holds database UUIDs once stored; the API decodes and encodes them at the edge. */
export interface ReportConfig {
  source: ReportSource;
  state: ReportState;
  projectIds: string[];
  columns: ReportColumn[];
  overdueOnly: boolean;
}

export interface SourceRow {
  id: string;
  ref: string;
  title: string;
  status: string;
  dueDate: string | null;
  overdue: boolean;
  createdAt: string;
}

export interface ResultRow extends SourceRow {
  projectId: string;
  project: string;
}

/** Most rows read per project, and in all. */
export const ROWS_PER_PROJECT = 500;
export const ROWS_TOTAL = 5000;
/** Most projects the portfolio and a report cover. */
export const PROJECT_LIMIT = 200;

/** Drops repeats and puts the columns in display order. An empty choice falls back to every column. */
export function normaliseColumns(columns: readonly ReportColumn[]): ReportColumn[] {
  const chosen = REPORT_COLUMNS.filter((c) => columns.includes(c));
  return chosen.length ? chosen : [...REPORT_COLUMNS];
}

export function normaliseConfig(c: ReportConfig): ReportConfig {
  return {
    source: c.source,
    state: c.state,
    projectIds: [...new Set(c.projectIds)],
    columns: normaliseColumns(c.columns),
    overdueOnly: c.overdueOnly,
  };
}

/** Project by name, then the source's own reference, so a report reads the same every run. */
export function sortRows(rows: readonly ResultRow[]): ResultRow[] {
  return [...rows].sort(
    (a, b) =>
      a.project.localeCompare(b.project) ||
      a.ref.localeCompare(b.ref, undefined, { numeric: true }) ||
      a.id.localeCompare(b.id),
  );
}

export interface ToolCounts {
  restricted: boolean;
  open: number;
  overdue: number;
  /** Open and due from today through the next 7 days (not overdue). Open items with no due date are in neither. */
  dueSoon: number;
}

/** Programme activities, with the split the schedule insights need on top of open and late. */
export interface ProgrammeCounts extends ToolCounts {
  notStarted: number;
  completed: number;
  /** Days late summed over the late activities, so the average is this over `overdue`. */
  lateDays: number;
}

export interface ProjectCounts {
  rfis: ToolCounts;
  defects: ToolCounts;
  submittals: ToolCounts;
  claims: ToolCounts;
  variations: ToolCounts;
  incidents: ToolCounts;
  programme: ProgrammeCounts;
}

/**
 * Budget against forecast for one project, in whole cents ex GST. Unlike the counts above this is money, so it is
 * not folded into `attention` or the ordering: a project over budget is not "overdue".
 */
export interface BudgetSummary {
  restricted: boolean;
  hasBudget: boolean;
  revisedCents: number;
  forecastFinalCents: number;
  /** Claimed by subcontractors plus direct costs recorded: what has been spent so far. */
  spentCents: number;
  /** Revised budget less forecast final cost: negative means the forecast is over budget. */
  varianceCents: number;
  /** Cost codes whose own forecast is over their revised budget. */
  overBudgetCodes: number;
  /** Spend by calendar month, oldest first, quiet months as zero. Empty when there is no spend. */
  monthly: { month: string; spentCents: number }[];
}

const money = (cents: number) => {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
};

/** The API shape of a project's budget line: decimal strings, and no figures at all when the caller may not see them. */
export const budgetView = (b: BudgetSummary) => ({
  restricted: b.restricted,
  hasBudget: b.hasBudget,
  revised: money(b.restricted || !b.hasBudget ? 0 : b.revisedCents),
  forecastFinal: money(b.restricted || !b.hasBudget ? 0 : b.forecastFinalCents),
  spent: money(b.restricted || !b.hasBudget ? 0 : b.spentCents),
  variance: money(b.restricted || !b.hasBudget ? 0 : b.varianceCents),
  overBudgetCodes: b.restricted || !b.hasBudget ? 0 : b.overBudgetCodes,
  monthly:
    b.restricted || !b.hasBudget
      ? []
      : b.monthly.map((m) => ({ month: m.month, spent: money(m.spentCents) })),
});

/** Company-wide budget position over the projects that have a budget the caller can see. */
export function budgetTotals(budgets: readonly BudgetSummary[]) {
  const seen = budgets.filter((b) => !b.restricted && b.hasBudget);
  const sum = (pick: (b: BudgetSummary) => number) => seen.reduce((n, b) => n + pick(b), 0);
  return {
    budgetProjects: seen.length,
    projectsOverBudget: seen.filter((b) => b.varianceCents < 0).length,
    budgetRevised: money(sum((b) => b.revisedCents)),
    budgetForecastFinal: money(sum((b) => b.forecastFinalCents)),
    budgetVariance: money(sum((b) => b.varianceCents)),
  };
}

export const attention = (p: ProjectCounts) =>
  p.rfis.overdue +
  p.defects.overdue +
  p.submittals.overdue +
  p.claims.overdue +
  p.variations.overdue;

/** Company totals; a tool the caller cannot read on a project adds nothing (its counts are zero). */
export function totals(projects: readonly ProjectCounts[]) {
  const sum = (pick: (p: ProjectCounts) => ToolCounts, key: 'open' | 'overdue') =>
    projects.reduce((n, p) => n + pick(p)[key], 0);
  return {
    projects: projects.length,
    rfisOpen: sum((p) => p.rfis, 'open'),
    rfisOverdue: sum((p) => p.rfis, 'overdue'),
    defectsOpen: sum((p) => p.defects, 'open'),
    defectsOverdue: sum((p) => p.defects, 'overdue'),
    submittalsOpen: sum((p) => p.submittals, 'open'),
    submittalsOverdue: sum((p) => p.submittals, 'overdue'),
    claimsOpen: sum((p) => p.claims, 'open'),
    claimsOverdue: sum((p) => p.claims, 'overdue'),
    variationsOpen: sum((p) => p.variations, 'open'),
    variationsOverdue: sum((p) => p.variations, 'overdue'),
    incidentsOpen: sum((p) => p.incidents, 'open'),
    incidentsOverdue: sum((p) => p.incidents, 'overdue'),
    programmeOpen: sum((p) => p.programme, 'open'),
    programmeOverdue: sum((p) => p.programme, 'overdue'),
  };
}

/** Most overdue first, then the busiest, then by name, so the page opens on what needs chasing. */
export function orderPortfolio<T extends { name: string; attention: number } & ProjectCounts>(
  rows: readonly T[],
): T[] {
  const open = (p: ProjectCounts) =>
    p.rfis.open +
    p.defects.open +
    p.submittals.open +
    p.claims.open +
    p.variations.open +
    p.incidents.open +
    p.programme.open;
  return [...rows].sort(
    (a, b) => b.attention - a.attention || open(b) - open(a) || a.name.localeCompare(b.name),
  );
}
