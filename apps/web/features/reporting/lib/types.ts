import type { components } from '@archova/contracts/openapi';

type S = components['schemas'];
export type DbpInsights = S['DbpInsights'];
export type Portfolio = S['Portfolio'];
export type PortfolioProject = S['PortfolioProject'];
export type PortfolioTool = S['PortfolioTool'];
export type PortfolioBudget = S['PortfolioBudget'];
export type ReadinessPack = S['ReadinessPack'];
export type Report = S['Report'];
export type ReportConfig = S['ReportConfig'];
export type ReportInput = S['ReportInput'];
export type ReportResult = S['ReportResult'];
export type ReportRow = S['ReportRow'];
export type ReportSource = ReportConfig['source'];
export type ReportState = ReportConfig['state'];
export type ReportColumn = ReportConfig['columns'][number];

export const SOURCE_LABELS: Record<ReportSource, string> = {
  rfis: 'RFIs',
  defects: 'Defects',
  submittals: 'Submittals',
  claims: 'Payment claims',
  variations: 'Variations',
  incidents: 'Safety incidents',
  programme: 'Programme activities',
};

export const STATE_LABELS: Record<ReportState, string> = {
  open: 'Still open',
  closed: 'Answered, paid or closed',
  all: 'Everything',
};

export const COLUMN_ORDER: readonly ReportColumn[] = [
  'project',
  'ref',
  'title',
  'status',
  'dueDate',
  'overdue',
  'createdAt',
];

export const COLUMN_LABELS: Record<ReportColumn, string> = {
  project: 'Project',
  ref: 'Reference',
  title: 'Title',
  status: 'Status',
  dueDate: 'Due',
  overdue: 'Overdue',
  createdAt: 'Created',
};

export const EMPTY_CONFIG: ReportConfig = {
  source: 'rfis',
  state: 'open',
  projectIds: [],
  columns: [...COLUMN_ORDER],
  overdueOnly: false,
};

/** "in_review" reads as "In review". */
export const statusLabel = (s: string) => {
  const words = s.replace(/_/g, ' ');
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

/** Columns in display order, so toggling one on slots it in where it belongs. */
export const orderColumns = (columns: readonly ReportColumn[]): ReportColumn[] =>
  COLUMN_ORDER.filter((c) => columns.includes(c));

function cellText(row: ReportRow, column: ReportColumn): string {
  switch (column) {
    case 'overdue':
      return row.overdue ? 'Yes' : 'No';
    case 'status':
      return statusLabel(row.status);
    case 'dueDate':
      return row.dueDate ?? '';
    case 'createdAt':
      return row.createdAt.slice(0, 10);
    default:
      return row[column];
  }
}

/** One CSV cell. A value a spreadsheet would run as a formula is prefixed so it opens as text. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(result: Pick<ReportResult, 'columns' | 'rows'>): string {
  const head = result.columns.map((c) => csvCell(COLUMN_LABELS[c]));
  const lines = result.rows.map((r) => result.columns.map((c) => csvCell(cellText(r, c))));
  return [head, ...lines].map((l) => l.join(',')).join('\r\n') + '\r\n';
}

export const cellValue = cellText;

export { ITEM_LABELS } from './itemLabels';
