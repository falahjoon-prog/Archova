// Report builder and portfolio rules. Pure, no IO.

export const REPORT_SOURCES = [
  'rfis',
  'defects',
  'submittals',
  'claims',
  'variations',
  'incidents',
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
}

export interface ProjectCounts {
  rfis: ToolCounts;
  defects: ToolCounts;
  submittals: ToolCounts;
  claims: ToolCounts;
  variations: ToolCounts;
  incidents: ToolCounts;
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
    p.incidents.open;
  return [...rows].sort(
    (a, b) => b.attention - a.attention || open(b) - open(a) || a.name.localeCompare(b.name),
  );
}
