import type {
  BimDiscipline,
  CoordinationIssuePriority,
  CoordinationIssueStatus,
} from '../data/api';

export const STATUS_LABEL: Record<CoordinationIssueStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};
export const PRIORITY_LABEL: Record<CoordinationIssuePriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};
export const DISCIPLINE_LABEL: Record<BimDiscipline, string> = {
  architectural: 'Architectural',
  structural: 'Structural',
  mechanical: 'Mechanical',
  electrical: 'Electrical',
  hydraulic: 'Hydraulic',
  fire: 'Fire',
  civil: 'Civil',
  other: 'Other',
};

/** The moves the server allows from each status; the screen offers only these. */
const NEXT: Record<CoordinationIssueStatus, CoordinationIssueStatus[]> = {
  open: ['in_progress', 'resolved', 'closed'],
  in_progress: ['open', 'resolved', 'closed'],
  resolved: ['closed', 'open'],
  closed: ['open'],
};
export const nextStatuses = (from: CoordinationIssueStatus) => NEXT[from];

export const statusTone = (s: CoordinationIssueStatus) =>
  s === 'open'
    ? 'warning'
    : s === 'in_progress'
      ? 'info'
      : s === 'resolved'
        ? 'success'
        : 'neutral';
export const priorityTone = (p: CoordinationIssuePriority) =>
  p === 'critical' ? 'danger' : p === 'high' ? 'warning' : 'neutral';

/** Element ids pasted one per line or separated by commas or spaces. */
export const parseGuids = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((g) => g.trim())
    .filter(Boolean);

export const issueLabel = (number: number) => `CI-${String(number).padStart(3, '0')}`;

/** An issue still needs someone to act on it. */
export const isActive = (s: CoordinationIssueStatus) => s === 'open' || s === 'in_progress';

export const PRIORITY_ORDER: CoordinationIssuePriority[] = ['critical', 'high', 'medium', 'low'];
